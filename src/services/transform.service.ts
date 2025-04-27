import {
	Direction,
	type FieldMapping,
	type MappingConfiguration,
	SourceType,
} from '@prisma/client';
import { type Readable, Transform } from 'node:stream';
import { sendResourceToFhirServer } from '../lib/fhir.client';
import { getMappingConfigurationByName } from '../repositories/mapping/getMappingConfiguration';
import type {
	StreamTransformResult,
	StreamTransformServiceParams,
} from '../types/StreamTransform';
import { getValue } from '../utils/getValueByPath';
import { setValue } from '../utils/setValueByPath';
import { FhirClientError } from './errors/FhirClientError';
import { InvalidInputDataError } from './errors/InvalidInputDataError';
import { createFhirResourceStream } from './fhir.fetch.service';
import {
	createCsvParserStream,
	createCsvStringifyStream,
	createJsonParserStream,
	createNdjsonStringifyStream,
} from './parser.service';

export async function streamTransformData({
	mappingConfigName,
	inputStream,
	sourceContentType,
	fhirQueryPath,
	sendToFhir = false,
	fhirServerUrlOverride,
}: StreamTransformServiceParams): Promise<StreamTransformResult> {
	// 1. Obter e VALIDAR a configuração de mapeamento (getMappingConfigurationByName agora valida)
	// Se a validação falhar aqui, um erro (InvalidMappingError ou StructureDefinitionNotProcessedError) será lançado.
	const mappingConfig = await getMappingConfigurationByName(mappingConfigName);

	// --- Variáveis do Pipeline ---
	let initialStream: Readable;
	let parserStream: Transform | null = null;
	let transformStream: Transform;
	let outputStream: Transform;
	let outputContentType: string;

	// 2. Configurar o Pipeline baseado na Direção
	if (mappingConfig?.direction === Direction.TO_FHIR) {
		// --- TO_FHIR: inputStream -> parser -> transformer -> serializer ---
		if (!inputStream || !sourceContentType) {
			throw new InvalidInputDataError(
				'Input stream and source content type are required for TO_FHIR direction.',
			);
		}
		initialStream = inputStream;

		if (sourceContentType.includes('csv')) {
			if (mappingConfig.sourceType !== SourceType.CSV)
				throw new InvalidInputDataError(
					`Mapping '${mappingConfigName}' expects ${mappingConfig.sourceType} but received CSV.`,
				);
			parserStream = createCsvParserStream();
		} else if (
			sourceContentType.includes('json') ||
			sourceContentType.includes('ndjson')
		) {
			if (mappingConfig.sourceType !== SourceType.JSON)
				throw new InvalidInputDataError(
					`Mapping '${mappingConfigName}' expects ${mappingConfig.sourceType} but received JSON/NDJSON.`,
				);
			parserStream = createJsonParserStream();
		} else {
			throw new InvalidInputDataError(
				`Unsupported source Content-Type for TO_FHIR: ${sourceContentType}. Use 'text/csv' or 'application/json'/'application/x-ndjson'.`,
			);
		}

		transformStream = createFhirTransformStream(
			mappingConfig,
			sendToFhir,
			fhirServerUrlOverride,
		);
		outputStream = createNdjsonStringifyStream();
		// Usar application/fhir+json pode ser enganoso para NDJSON, mas é o que muitos esperam.
		// application/x-ndjson é mais correto tecnicamente.
		outputContentType = 'application/fhir+json'; // Ou 'application/x-ndjson'
	} else if (mappingConfig?.direction === Direction.FROM_FHIR) {
		// --- FROM_FHIR: fhirStream -> transformer -> serializer ---
		if (!fhirQueryPath) {
			throw new InvalidInputDataError(
				'fhirQueryPath parameter is required for FROM_FHIR direction.',
			);
		}
		parserStream = null;

		console.log(`FROM_FHIR: Creating FHIR stream for query: ${fhirQueryPath}`);
		initialStream = createFhirResourceStream({
			initialUrl: fhirQueryPath,
			fhirServerUrl: fhirServerUrlOverride ?? process.env.FHIR_SERVER_BASE_URL, // Usa override ou .env
		});

		transformStream = createFhirTransformStream(
			mappingConfig,
			false,
			undefined,
		);

		if (mappingConfig.sourceType === SourceType.CSV) {
			outputStream = createCsvStringifyStream();
			outputContentType = 'text/csv';
		} else {
			// Target é JSON
			outputStream = createNdjsonStringifyStream();
			outputContentType = 'application/x-ndjson';
		}
	} else {
		// Caso a direção seja inválida no banco (não deve acontecer com o enum)
		throw new Error(
			`Unsupported transformation direction found in mapping '${mappingConfigName}': ${mappingConfig?.direction}`,
		);
	}

	// 3. Montar a Cadeia de Streams (Pipeline)
	// biome-ignore lint/style/useConst: <explanation>
	let finalOutputStream: Readable;
	const pipelineStreams: Readable[] = [initialStream];
	if (parserStream) pipelineStreams.push(parserStream);
	pipelineStreams.push(transformStream);
	pipelineStreams.push(outputStream);

	// pipeline pode lidar com array de streams
	finalOutputStream = pipelineStreams.reduce((prev, current) =>
		prev.pipe(current as Transform),
	);

	// Adiciona tratamento de erro genérico para logar falhas no pipeline
	finalOutputStream.on('error', (err) => {
		console.error(
			`STREAM PIPELINE ERROR for mapping '${mappingConfigName}':`,
			err,
		);
		// Destruir streams anteriores pode ser complexo de gerenciar aqui
		// O importante é que o erro seja logado. O cliente receberá uma resposta interrompida.
	});

	// 4. Retornar o stream final e o content type
	return {
		outputStream: finalOutputStream,
		outputContentType: outputContentType,
	};
}

// --- Helper para criar o Transform Stream ---
function createFhirTransformStream(
	config: MappingConfiguration & { fieldMappings: FieldMapping[] },
	sendToFhir: boolean,
	fhirServerUrlOverride?: string,
): Transform {
	return new Transform({
		objectMode: true,
		writableHighWaterMark: 16, // Ajustar buffer se necessário
		readableHighWaterMark: 16,
		async transform(chunk, _, callback) {
			try {
				let resultItem: any = null;
				if (config.direction === Direction.TO_FHIR) {
					resultItem = transformSingleItemToFhir(chunk, config);
					if (resultItem && sendToFhir) {
						// Envio assíncrono, não espera, apenas dispara
						sendResourceToFhirServer({
							resource: resultItem,
							resourceType: config.fhirResourceType,
							fhirServerUrl: fhirServerUrlOverride,
						})
							.then((response) => {
								// Log apenas se não for um OperationOutcome de erro
								if (
									response?.resourceType !== 'OperationOutcome' ||
									response?.issue?.every(
										(i: any) =>
											i.severity === 'information' || i.severity === 'warning',
									)
								) {
									console.log(
										`FHIR Client: Async send successful for ${config.fhirResourceType}/${response?.id || '(no id)'}`,
									);
								} else {
									console.warn(
										`FHIR Client: Async send for ${config.fhirResourceType} resulted in OperationOutcome:`,
										response.issue,
									);
								}
							})
							.catch((err) => {
								// Logar erro do envio assíncrono
								console.error(
									`FHIR Client: Async send ERROR for ${config.fhirResourceType}: ${err.message}`,
									err instanceof FhirClientError ? err.responseData : '',
								);
							});
					}
				} else if (config.direction === Direction.FROM_FHIR) {
					resultItem = transformSingleItemFromFhir(chunk, config);
				}

				if (resultItem !== null) {
					// Só envia para o próximo estágio se não for nulo
					this.push(resultItem);
				}
				callback(); // Processamento deste chunk ok
			} catch (error: any) {
				console.error(
					'TRANSFORM STREAM ERROR:',
					error,
					'Failed Item (limited view):',
					JSON.stringify(chunk).substring(0, 200),
				);
				callback(error); // Propaga o erro, vai parar o pipeline
			}
		},
	});
}

// --- Funções de Transformação de Item Individual ---

function transformSingleItemToFhir(
	item: any,
	config: MappingConfiguration & { fieldMappings: FieldMapping[] },
): any {
	// Inicia o recurso APENAS com resourceType
	const fhirResource: any = {
		resourceType: config.fhirResourceType,
	};
	// Adiciona meta.profile se a SD foi especificada no mapeamento
	if (config.structureDefinitionUrl) {
		setValue(fhirResource, 'meta.profile[0]', config.structureDefinitionUrl);
	}

	for (const mapping of config.fieldMappings) {
		const sourceValue = getValue(item, mapping.sourcePath);

		// Obtém o targetFhirPath CORRIGIDO (sem prefixo de tipo)
		const targetPath = mapping.targetFhirPath; // Deve ser relativo (ex: 'id', 'name[0].text')

		if (sourceValue !== undefined && sourceValue !== null && targetPath) {
			// Define o valor usando o path relativo
			setValue(fhirResource, targetPath, sourceValue);
		}
	}
	return fhirResource;
}

function transformSingleItemFromFhir(
	fhirResource: any,
	config: MappingConfiguration & { fieldMappings: FieldMapping[] },
): any {
	const outputItem: any = {};

	if (!fhirResource || fhirResource?.resourceType !== config.fhirResourceType) {
		console.warn(
			`FROM_FHIR: Skipping item. Expected FHIR resourceType '${config.fhirResourceType}' but got '${fhirResource?.resourceType}'.`,
		);
		return null; // Retorna nulo para ser filtrado no stream
	}

	for (const mapping of config.fieldMappings) {
		const fhirPath = mapping.targetFhirPath; // Path dentro do recurso FHIR
		const targetPath = mapping.sourcePath; // Path no JSON/CSV de saída

		if (fhirPath && targetPath) {
			const fhirValue = getValue(fhirResource, fhirPath);

			if (fhirValue !== undefined && fhirValue !== null) {
				// Se o destino for CSV, usamos apenas a primeira parte do sourcePath como chave
				if (config.sourceType === SourceType.CSV) {
					const columnName = targetPath.split('.')[0] || targetPath; // Pega a primeira parte
					outputItem[columnName] = fhirValue;
				} else {
					// Para JSON, permite aninhar usando o sourcePath completo
					setValue(outputItem, targetPath, fhirValue);
				}
			}
		}
	}
	return outputItem;
}
