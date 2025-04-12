import {
	Direction,
	type MappingConfiguration,
	SourceType,
} from '@prisma/client';
import { sendResourceToFhirServer } from '../lib/fhir.client';
import { getMappingConfigurationByName } from '../repositories/mapping/getMappingConfiguration';
import { getValue } from '../utils/getValueByPath';
import { setValue } from '../utils/setValueByPath';
import { InvalidInputDataError } from './errors/InvalidInputDataError';
import {
	parseCsv,
	parseJson,
	serializeToCsv,
	serializeToJson,
} from './parser.service';

interface TransformDataParams {
	mappingConfigName: string;
	inputData: any;
	sendToFhir?: boolean;
	fhirServerUrlOverride?: string;
}

interface TransformResult {
	transformedData: any; // Pode ser string (CSV/JSON) ou objeto (FHIR) dependendo do fluxo
	contentType: string; // 'application/json', 'text/csv', 'application/fhir+json'
	fhirServerResponse?: any; // Resposta do servidor FHIR, se aplicável
}

export async function transformData({
	mappingConfigName,
	inputData,
	sendToFhir = false,
	fhirServerUrlOverride,
}: TransformDataParams): Promise<TransformResult> {
	// 1. Obter a configuração de mapeamento
	const mappingConfig = await getMappingConfigurationByName(mappingConfigName);

	// 2. Parsear dados de entrada com base no sourceType da configuração
	let parsedData: any[];
	if (mappingConfig?.sourceType === SourceType.CSV) {
		if (typeof inputData !== 'string')
			throw new InvalidInputDataError(
				'Expected CSV data as a string for this mapping.',
			);
		parsedData = parseCsv(inputData);
	} else if (mappingConfig?.sourceType === SourceType.JSON) {
		// Aceita objeto/array direto ou string JSON
		parsedData = parseJson(inputData);
		// Garante que temos um array para iterar, mesmo que seja um único objeto JSON
		if (!Array.isArray(parsedData)) {
			parsedData = [parsedData];
		}
	} else {
		throw new Error(`Unsupported source type: ${mappingConfig?.sourceType}`);
	}

	if (!Array.isArray(parsedData) || parsedData.length === 0) {
		// Pode retornar um resultado vazio ou lançar erro, dependendo do requisito
		console.warn(
			`No data found after parsing input for mapping '${mappingConfigName}'`,
		);
		// Retornando vazio como exemplo:
		const isEmptyResult =
			mappingConfig?.direction === Direction.FROM_FHIR &&
			mappingConfig?.sourceType === SourceType.CSV;
		return {
			transformedData: isEmptyResult ? '' : [], // String vazia para CSV, array vazio para JSON/FHIR
			contentType: isEmptyResult ? 'text/csv' : 'application/json', // Ajustar conforme necessário
		};
	}

	// 3. Aplicar Transformação (Item por Item)
	const transformationPromises = parsedData.map(async (item) => {
		if (mappingConfig?.direction === Direction.TO_FHIR)
			return transformSingleItemToFhir(item, mappingConfig);

		// FROM_FHIR: item aqui é um recurso FHIR
		// Precisa implementar transformSingleItemFromFhir
		if (mappingConfig?.direction === Direction.FROM_FHIR)
			return transformSingleItemFromFhir(item, mappingConfig);

		throw new Error(
			`Unsupported transformation direction: ${mappingConfig?.direction}`,
		);
	});

	const transformedItems = await Promise.all(transformationPromises);

	// 4. Pós-processamento e Envio (se aplicável)
	let finalOutput: any;
	let contentType: string;
	let fhirServerResponse: any = undefined;

	if (mappingConfig?.direction === Direction.TO_FHIR) {
		// Resultado é um array de recursos FHIR
		finalOutput =
			transformedItems.length === 1 ? transformedItems[0] : transformedItems; // Retorna objeto único se houver só 1 item
		contentType = 'application/fhir+json'; // Ou application/json se preferir

		if (sendToFhir) {
			console.log(
				`Sending ${transformedItems.length} resource(s) to FHIR server...`,
			);
			// Envia cada recurso individualmente (ou em um Bundle, mais complexo)
			const sendPromises = transformedItems.map((resource) =>
				sendResourceToFhirServer({
					resource,
					resourceType: mappingConfig?.fhirResourceType,
					fhirServerUrl: fhirServerUrlOverride,
					// Poderia adicionar lógica para decidir entre POST/PUT aqui
				}),
			);
			// Coleta todas as respostas (ou a primeira, ou um resumo)
			try {
				fhirServerResponse = await Promise.all(sendPromises);
				console.log('Successfully sent resources to FHIR server.');
			} catch (error) {
				console.error('Error sending resources to FHIR server:', error);
				// Decide se quer lançar o erro ou apenas logar e retornar a transformação local
				// Lançar o erro pode ser mais informativo para o cliente API
				throw error; // Re-lança o erro do cliente FHIR
			}
		}

		// Serializa para string JSON para a resposta HTTP (opcional, Fastify pode fazer)
		finalOutput = serializeToJson(finalOutput);
	} else {
		// FROM_FHIR
		// Resultado é um array de objetos JSON ou linhas CSV
		if (mappingConfig?.sourceType === SourceType.CSV) {
			finalOutput = serializeToCsv(transformedItems);
			contentType = 'text/csv';
		} else {
			// Target é JSON
			finalOutput = serializeToJson(
				transformedItems.length === 1 ? transformedItems[0] : transformedItems,
			);
			contentType = 'application/json';
		}
	}

	return {
		transformedData: finalOutput,
		contentType: contentType,
		fhirServerResponse: fhirServerResponse, // Inclui a resposta do servidor FHIR se foi enviado
	};
}

// --- Funções Auxiliares de Transformação ---

// Transforma um único item (linha CSV ou objeto JSON) para um recurso FHIR
function transformSingleItemToFhir(
	item: any,
	config: MappingConfiguration & { fieldMappings: any[] },
): any {
	// Cria um objeto FHIR base. No mínimo, precisa do resourceType.
	const fhirResource: any = {
		resourceType: config.fhirResourceType,
		// Poderia adicionar meta.profile aqui se definido na config
	};

	// Aplica cada mapeamento de campo
	// biome-ignore lint/complexity/noForEach: <explanation>
	config.fieldMappings.forEach((mapping) => {
		// Obtém o valor da fonte usando sourcePath
		const sourceValue = getValue(item, mapping.sourcePath);

		// Se o valor existir (ou se for 0 ou false, que são válidos)
		if (sourceValue !== undefined && sourceValue !== null) {
			// Define o valor no recurso FHIR usando targetFhirPath
			// **ATENÇÃO:** setValueByPath precisa ser robusto para criar estruturas aninhadas FHIR!
			setValue(fhirResource, mapping.targetFhirPath, sourceValue);
		} else {
			// console.warn(`Source path "${mapping.sourcePath}" not found or null in item:`, item);
			// Poderia usar um defaultValue aqui se definido no mapeamento
		}
	});

	// TODO: Adicionar validação do recurso FHIR gerado (complexo)
	// Ex: usando Zod schemas derivados de StructureDefinitions ou libs FHIR

	return fhirResource;
}

// Transforma um único recurso FHIR para um objeto JSON ou linha CSV
function transformSingleItemFromFhir(
	fhirResource: any,
	config: MappingConfiguration & { fieldMappings: any[] },
): any {
	const outputItem: any = {};

	// Verifica se o recurso FHIR tem o tipo esperado
	if (fhirResource?.resourceType !== config.fhirResourceType) {
		console.warn(
			`Expected FHIR resourceType '<span class="math-inline">\{config\.fhirResourceType\}' but got '</span>{fhirResource?.resourceType}'. Skipping item.`,
		);
		return null; // Ou lança erro, ou retorna objeto vazio
	}

	// biome-ignore lint/complexity/noForEach: <explanation>
	config.fieldMappings.forEach((mapping) => {
		// Obtém o valor do FHIR usando targetFhirPath
		// **ATENÇÃO:** getValueByPath precisa entender FHIRPath minimamente ou usar lib específica.
		const fhirValue = getValue(fhirResource, mapping.targetFhirPath);

		if (fhirValue !== undefined && fhirValue !== null) {
			// Define o valor no objeto de saída usando sourcePath
			// Para CSV, sourcePath é geralmente o nome da coluna. Para JSON, pode ser aninhado.
			// A implementação atual de setValueByPath pode funcionar para JSON de saída.
			// Para CSV, precisamos garantir que outputItem seja plano (chave-valor direto) se sourceType for CSV.
			if (config.sourceType === SourceType.CSV) {
				// Garante que a chave seja simples (sem pontos/colchetes)
				const columnName =
					mapping.sourcePath.split(/[.\[\]]+/)[0] || mapping.sourcePath;
				outputItem[columnName] = fhirValue;
			} else {
				setValue(outputItem, mapping.sourcePath, fhirValue);
			}
		}
	});

	return outputItem;
}
