import {
	Direction,
	type FieldMapping,
	type MappingConfiguration,
	SourceType,
} from '@prisma/client';
import { type Duplex, type Readable, Transform } from 'node:stream';
import { sendResourceToFhirServer } from '../lib/fhir.client';
import { getMappingConfigurationByName } from '../repositories/mapping/getMappingConfiguration';
import type { FieldProcessingError } from '../types/FieldProcessing';
import type {
	StreamItemError,
	StreamTransformResult,
	StreamTransformServiceParams,
} from '../types/StreamTransform';
import { getValue } from '../utils/getValueByPath';
import { setValue } from '../utils/setValueByPath';
import {
	transformationRegistry,
	validationRegistry,
} from '../utils/transformation';
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

	let initialStream: Readable;
	let parserStream: Duplex | null = null;
	let transformStream: Transform;
	let outputStream: Transform;
	let outputContentType: string;

	// 2. Configurar o Pipeline baseado na Direção
	if (mappingConfig?.direction === Direction.TO_FHIR) {
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
		outputContentType = 'application/fhir+json';
	} else if (mappingConfig?.direction === Direction.FROM_FHIR) {
		if (!fhirQueryPath) {
			throw new InvalidInputDataError(
				'fhirQueryPath parameter is required for FROM_FHIR direction.',
			);
		}
		parserStream = null;

		console.log(`FROM_FHIR: Creating FHIR stream for query: ${fhirQueryPath}`);
		initialStream = createFhirResourceStream({
			initialUrl: fhirQueryPath,
			fhirServerUrl: fhirServerUrlOverride ?? process.env.FHIR_SERVER_BASE_URL,
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

		async transform(chunk, encoding, callback) {
			const itemErrors: FieldProcessingError[] = [];
			let resultItem: any = null;
			const sourceItem = chunk; // Item de entrada (linha CSV, obj JSON, Recurso FHIR)

			try {
				// --- Define o objeto de saída inicial ---
				let outputItem: any = {};
				if (config.direction === Direction.TO_FHIR) {
					outputItem = { resourceType: config.fhirResourceType };
					if (config.structureDefinitionUrl) {
						setValue(
							outputItem,
							'meta.profile[0]',
							config.structureDefinitionUrl,
						);
					}
				}

				// --- Processa cada mapeamento de campo ---
				for (const mapping of config.fieldMappings) {
					const sourceValue = getValue(sourceItem, mapping.sourcePath);
					const targetPath =
						config.direction === Direction.TO_FHIR
							? mapping.targetFhirPath
							: mapping.sourcePath;
					const fhirPath =
						config.direction === Direction.TO_FHIR
							? mapping.targetFhirPath
							: mapping.sourcePath;

					if (!targetPath) continue;

					let valueToProcess = sourceValue;
					let currentError: string | null = null;

					// 1. Tratamento Especial: DEFAULT_VALUE se valor original for nulo/undefined
					if (
						(valueToProcess === null || valueToProcess === undefined) &&
						mapping.transformationType?.toUpperCase() === 'DEFAULT_VALUE'
					) {
						const defaultFunc = transformationRegistry.get('DEFAULT_VALUE');
						if (defaultFunc) {
							const result = defaultFunc(null, mapping.transformationDetails);
							if (result.success) {
								valueToProcess = result.value;
							} else {
								currentError =
									result.message || 'Failed to apply default value';
							}
						} else {
							currentError =
								'DEFAULT_VALUE transformation function not registered.';
						}
					}

					// 2. Validação (Aplica se não houve erro e se há tipo de validação)
					if (!currentError && mapping.validationType) {
						const validationFunc = validationRegistry.get(
							mapping.validationType.toUpperCase(),
						);
						if (validationFunc) {
							// Passa o valor ATUAL (pode ter vindo do default value)
							const validationErrorMsg = validationFunc(
								valueToProcess,
								mapping.validationDetails,
								{ sourceItem },
							);
							if (validationErrorMsg) {
								currentError = validationErrorMsg; // Guarda a mensagem de erro de validação
								itemErrors.push({
									fieldSourcePath: mapping.sourcePath,
									fieldTargetPath: targetPath,
									inputValue: sourceValue, // Reporta valor original
									errorType: 'Validation',
									message: validationErrorMsg,
									details: {
										type: mapping.validationType,
										details: mapping.validationDetails,
									},
								});
							}
						} else {
							const errMsg = `Validation function '${mapping.validationType}' not registered.`;
							console.warn(`[Config Error] ${errMsg}`);
							// Decide se adiciona como erro ou só loga
							itemErrors.push({
								fieldSourcePath: mapping.sourcePath,
								fieldTargetPath: targetPath,
								inputValue: sourceValue,
								errorType: 'Validation',
								message: errMsg,
							});
						}
					}

					// 3. Transformação (Aplica se não houve erro até agora e se há tipo de transformação *diferente* de DEFAULT_VALUE)
					if (
						!currentError &&
						mapping.transformationType &&
						mapping.transformationType.toUpperCase() !== 'DEFAULT_VALUE'
					) {
						const transformationFunc = transformationRegistry.get(
							mapping.transformationType.toUpperCase(),
						);
						if (transformationFunc) {
							// Passa o valor ATUAL
							const transformResult = transformationFunc(
								valueToProcess,
								mapping.transformationDetails,
								{ sourceItem },
							);
							if (transformResult.success) {
								valueToProcess = transformResult.value; // Atualiza com valor transformado
							} else {
								currentError =
									transformResult.message ||
									`Transformation '${mapping.transformationType}' failed.`;
								itemErrors.push({
									fieldSourcePath: mapping.sourcePath,
									fieldTargetPath: targetPath,
									inputValue: sourceValue, // Reporta valor original
									errorType: 'Transformation',
									message: currentError,
									details: {
										type: mapping.transformationType,
										details: mapping.transformationDetails,
									},
								});
							}
						} else {
							const errMsg = `Transformation function '${mapping.transformationType}' not registered.`;
							console.warn(`[Config Error] ${errMsg}`);
							itemErrors.push({
								fieldSourcePath: mapping.sourcePath,
								fieldTargetPath: targetPath,
								inputValue: sourceValue,
								errorType: 'Transformation',
								message: errMsg,
							});
						}
					}

					// 4. Define o valor final no item de saída, *se não houve erro* para este campo específico? (Decisão de projeto)
					//    Ou define mesmo se houve erro? Vamos definir apenas se currentError for null.
					if (
						currentError === null &&
						valueToProcess !== undefined &&
						valueToProcess !== null
					) {
						if (
							config.direction === Direction.FROM_FHIR &&
							config.sourceType === SourceType.CSV
						) {
							const columnName = targetPath.split('.')[0] || targetPath;
							outputItem[columnName] = valueToProcess;
						} else {
							setValue(outputItem, targetPath, valueToProcess);
						}
					}
				} // Fim do loop de fieldMappings

				// Define resultItem baseado na direção
				if (config.direction === Direction.TO_FHIR) {
					resultItem = outputItem;
					// Envio Assíncrono (só se não houver erros no item completo)
					if (itemErrors.length === 0 && resultItem && sendToFhir) {
						sendResourceToFhirServer({
							resource: resultItem,
							resourceType: config.fhirResourceType,
							fhirServerUrl: fhirServerUrlOverride,
						});
					}
				} else {
					// FROM_FHIR
					// Só retorna se não for um objeto vazio (pode acontecer se nenhum campo for mapeado ou todos falharem)
					if (Object.keys(outputItem).length > 0 || itemErrors.length > 0) {
						resultItem = outputItem;
					} else {
						resultItem = null;
					}
				}

				if (itemErrors.length > 0) {
					this.push({
						_isTransformError: true,
						errors: itemErrors,
						originalItem: chunk,
					} as StreamItemError);
				} else if (resultItem !== null) {
					this.push(resultItem);
				}
				callback();
			} catch (error: any) {
				console.error(
					'UNEXPECTED TRANSFORM STREAM ERROR:',
					error,
					'Item:',
					JSON.stringify(chunk).substring(0, 200),
				);
				this.push({
					_isTransformError: true,
					errors: [
						{
							fieldTargetPath: 'N/A',
							inputValue: chunk,
							errorType: 'Transformation',
							message: `Unexpected error processing item: ${error.message}`,
						},
					],
					originalItem: chunk,
				} as StreamItemError);
				callback();
			}
		},
	});
}
