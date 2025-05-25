import axios from 'axios';
import { Readable } from 'node:stream';
import type { FhirResourceStreamOptions } from '../types/FhirResource';
import { FhirClientError } from './errors/FhirClientError';

const DEFAULT_FHIR_SERVER_URL =
	process.env.FHIR_SERVER_BASE_URL || 'http://localhost:8080/fhir';
const DEFAULT_PAGE_SIZE = 50;

export class FhirResourceStream extends Readable {
	private fhirBaseUrl: string;
	private nextPageUrl: string | null;
	private fetching: boolean;
	private pageSize: number;
	private resourceQueue: any[];
	private totalFetched = 0;

	constructor(options: FhirResourceStreamOptions) {
		super({
			objectMode: true,
			highWaterMark: options.pageSize || DEFAULT_PAGE_SIZE,
		}); // Ajusta highWaterMark
		this.fhirBaseUrl = options.fhirServerUrl || DEFAULT_FHIR_SERVER_URL;
		this.pageSize = options.pageSize || DEFAULT_PAGE_SIZE;

		try {
			// Garante que a URL inicial seja válida e inclua _count e _format
			// Corrige para garantir que o /fhir do base não seja ignorado
			let initialPath = options.initialUrl;
			if (initialPath.startsWith('/')) {
				initialPath = initialPath.slice(1); // remove barra inicial
			}
			const initialUrlObj = new URL(
				initialPath,
				this.fhirBaseUrl.endsWith('/')
					? this.fhirBaseUrl
					: `${this.fhirBaseUrl}/`,
			);

			console.log('initialUrlObj', initialUrlObj);

			initialUrlObj.searchParams.set('_count', String(this.pageSize));
			initialUrlObj.searchParams.set('_format', 'json');
			this.nextPageUrl = initialUrlObj.toString();
			console.log('this.nextPageUrl', this.nextPageUrl);
		} catch (e: any) {
			console.error(
				`FhirResourceStream: Invalid initial URL provided: ${options.initialUrl}`,
				e,
			);
			// Emite erro imediatamente ao construir se URL for inválida
			this.nextPageUrl = null; // Impede fetch
			// Usa setImmediate para emitir erro após o construtor retornar
			setImmediate(() =>
				this.emit(
					'error',
					new Error(`Invalid initial FHIR query URL: ${options.initialUrl}`),
				),
			);
		}

		this.fetching = false;
		this.resourceQueue = [];
	}

	async _read(size: number) {
		// Preenche o buffer interno até highWaterMark ou até acabar os dados
		while (this.readableLength < this.readableHighWaterMark) {
			// Processa itens na fila primeiro
			if (this.resourceQueue.length > 0) {
				const resource = this.resourceQueue.shift();
				this.totalFetched++;
				if (!this.push(resource)) {
					// Se push retornar false, o buffer interno está cheio, paramos de ler por ora
					// console.log(`FhirResourceStream: Internal buffer full (pushed ${this.totalFetched} resources), pausing fetch.`);
					return;
				}
				// Continua no loop para enviar mais da fila se houver espaço
				continue;
			}

			// Fila vazia, verifica se ainda há páginas para buscar
			if (!this.fetching && this.nextPageUrl) {
				// Inicia o fetch da próxima página (não bloqueia _read)
				this.fetchNextPage();
				// Retorna por agora, _read será chamado novamente quando necessário
				return;
			}

			// Se não está buscando, não há próxima página, e a fila está vazia, termina o stream
			if (
				!this.fetching &&
				!this.nextPageUrl &&
				this.resourceQueue.length === 0
			) {
				console.log(
					`FhirResourceStream: Finished fetching. Total resources pushed: ${this.totalFetched}`,
				);
				this.push(null); // Fim do stream
				return; // Sai do loop e da função _read
			}

			// Se está buscando (fetching = true), apenas retorna e espera o fetch terminar
			if (this.fetching) {
				// console.log('FhirResourceStream: Fetch in progress, waiting...');
				return;
			}

			// Se chegou aqui, algo inesperado ocorreu (ex: estado inconsistente)
			// console.log('FhirResourceStream: Reached unexpected state in _read.');
			return;
		} // Fim do while

		// Se saiu do loop porque o buffer está cheio, _read será chamado novamente quando houver espaço
		// console.log(`FhirResourceStream: Exiting _read, buffer potentially full (readableLength: ${this.readableLength}).`);
	}

	private async fetchNextPage(): Promise<void> {
		if (this.fetching || !this.nextPageUrl) return; // Previne fetches múltiplos ou desnecessários

		this.fetching = true;
		const urlToFetch = this.nextPageUrl;
		this.nextPageUrl = null; // Limpa para o próximo ciclo

		// console.log(`FhirResourceStream: Fetching page: ${urlToFetch}`);

		try {
			console.log('urlToFetch', urlToFetch);
			const response = await axios.get(urlToFetch, {
				headers: {
					Accept: 'application/fhir+json',
					// TODO: Adicionar headers de autenticação
				},
				timeout: 60000,
			});

			const bundle = response.data;

			if (bundle?.resourceType === 'Bundle' && Array.isArray(bundle.entry)) {
				for (const entry of bundle.entry) {
					if (entry.resource) {
						this.resourceQueue.push(entry.resource);
					}
				}
				const nextLink = bundle.link?.find(
					(link: { relation: string; url?: string }) =>
						link.relation === 'next',
				);
				if (nextLink?.url) {
					this.nextPageUrl = nextLink.url;
				}
			} else {
				console.warn(
					`FhirResourceStream: Received non-Bundle or empty response from ${urlToFetch}`,
				);
			}
		} catch (error: any) {
			let status: number | undefined;
			let responseData: any;
			let errorMessage = `FhirResourceStream: Error fetching ${urlToFetch}.`;
			if (axios.isAxiosError(error)) {
				status = error.response?.status;
				responseData = error.response?.data;
				errorMessage += ` Status: ${status}. Response: ${JSON.stringify(responseData)}`;
			} else {
				errorMessage += ` Error: ${error.message}`;
			}
			console.error(errorMessage);
			// Emite erro no stream. O _read vai parar e eventualmente emitir push(null)
			this.emit(
				'error',
				new FhirClientError(errorMessage, urlToFetch, status, responseData),
			);
		} finally {
			this.fetching = false;
			// Chama _read novamente para processar a fila ou terminar o stream
			// Faz isso no finally para garantir que _read seja chamado mesmo se fetchNextPage
			// for chamado enquanto um fetch anterior ainda estava em andamento (embora a flag 'fetching' tente evitar isso).
			this._read(this.readableHighWaterMark); // Tenta preencher o buffer
		}
	}
}

export function createFhirResourceStream(
	options: FhirResourceStreamOptions,
): Readable {
	return new FhirResourceStream(options);
}
