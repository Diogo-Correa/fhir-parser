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
import { applyTransformation } from '../utils/applyTransformation';
import { getValue } from '../utils/getValueByPath';
import { setValue } from '../utils/setValueByPath';
import { validateValue } from '../utils/validateValue';
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
	let parserStream: Duplex | null = null;
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
		writableHighWaterMark: 16,
		readableHighWaterMark: 16,
		async transform(chunk, encoding, callback) {
			const itemErrors: FieldProcessingError[] = []; // Coleta erros para este chunk
			let resultItem: any = null; // Armazena o item transformado (ou null se erro total)

			try {
				if (config.direction === Direction.TO_FHIR) {
					// --- TO_FHIR ---
					const sourceItem = chunk;
					const fhirResource: any = { resourceType: config.fhirResourceType };
					if (config.structureDefinitionUrl) {
						setValue(
							fhirResource,
							'meta.profile[0]',
							config.structureDefinitionUrl,
						);
					}

					for (const mapping of config.fieldMappings) {
						const sourceValue = getValue(sourceItem, mapping.sourcePath);
						let valueToSet = sourceValue; // Valor inicial
						let transformationApplied = false;

						// 1. Validação (só valida se sourceValue não for nulo, exceto para REQUIRED)
						if (
							mapping.validationType &&
							(mapping.validationType.toUpperCase() === 'REQUIRED' ||
								(sourceValue !== null && sourceValue !== undefined))
						) {
							const validationError = validateValue(
								sourceValue,
								mapping.validationType,
								mapping.validationDetails,
							);
							if (validationError) {
								itemErrors.push({
									fieldSourcePath: mapping.sourcePath,
									fieldTargetPath: mapping.targetFhirPath,
									inputValue: sourceValue,
									errorType: 'Validation',
									message: validationError,
									details: {
										type: mapping.validationType,
										details: mapping.validationDetails,
									},
								});
								// Decide se continua: talvez não setar o valor se a validação falhar? Ou parar tudo?
								// Por enquanto, apenas registra o erro e continua para transformação (se houver)
								// Poderia adicionar uma flag 'stopOnError' na validação
							}
						}

						// 2. Transformação (se houver) - só executa se não houver erro de validação *grave*? (Não implementado)
						if (mapping.transformationType) {
							const transformResult = applyTransformation(
								sourceValue,
								mapping.transformationType,
								mapping.transformationDetails,
								sourceItem,
							);
							if (transformResult.success) {
								valueToSet = transformResult.value; // Usa valor transformado
								transformationApplied = true;
							} else {
								itemErrors.push({
									fieldSourcePath: mapping.sourcePath,
									fieldTargetPath: mapping.targetFhirPath,
									inputValue: sourceValue,
									errorType: 'Transformation',
									// biome-ignore lint/style/noNonNullAssertion: <explanation>
									message: transformResult.message!,
									details: {
										type: mapping.transformationType,
										details: mapping.transformationDetails,
									},
								});
								// Se a transformação falhou, provavelmente não setamos o valor? Ou setamos o original?
								// Por enquanto, vamos setar o valor original se a transformação falhar.
								valueToSet = sourceValue;
							}
						}

						// 3. Define o valor (final) no recurso FHIR
						const targetPath = mapping.targetFhirPath;
						// Só define se o valor final não for undefined/null (ou se for resultado de DEFAULT_VALUE)
						if (
							(valueToSet !== undefined && valueToSet !== null && targetPath) ||
							(transformationApplied &&
								mapping.transformationType?.toUpperCase() === 'DEFAULT_VALUE')
						) {
							// Não setar se houve erro de validação? (Decisão de projeto) - Por enquanto, seta mesmo com erro de validação.
							setValue(fhirResource, targetPath, valueToSet);
						}
					} // Fim do loop de fieldMappings

					resultItem = fhirResource; // O recurso FHIR montado

					// Envio Assíncrono (como antes)
					if (itemErrors.length === 0 && resultItem && sendToFhir) {
						// Só envia se não houver erros no item
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
					// --- FROM_FHIR ---
					const fhirResource = chunk;
					const outputItem: any = {};

					if (
						!fhirResource ||
						fhirResource?.resourceType !== config.fhirResourceType
					) {
						itemErrors.push({
							fieldTargetPath: 'N/A',
							inputValue: fhirResource,
							errorType: 'Validation',
							message: `Expected '${config.fhirResourceType}', got '${fhirResource?.resourceType}'. Skipping.`,
						});
						resultItem = null; // Não processa
					} else {
						for (const mapping of config.fieldMappings) {
							const fhirPath = mapping.targetFhirPath;
							const targetPath = mapping.sourcePath; // Path no JSON/CSV de saída
							let valueToSet: any = null; // Valor final para o outputItem

							if (fhirPath && targetPath) {
								const sourceValue = getValue(fhirResource, fhirPath);

								// 1. Validação (Aplicada ao valor FHIR? Menos comum, mas possível)
								if (
									mapping.validationType &&
									(mapping.validationType.toUpperCase() === 'REQUIRED' ||
										(sourceValue !== null && sourceValue !== undefined))
								) {
									const validationError = validateValue(
										sourceValue,
										mapping.validationType,
										mapping.validationDetails,
									);
									if (validationError) {
										itemErrors.push({
											fieldSourcePath: fhirPath,
											fieldTargetPath: targetPath,
											inputValue: sourceValue,
											errorType: 'Validation',
											message: validationError,
											details: {
												type: mapping.validationType,
												details: mapping.validationDetails,
											},
										});
									}
								}

								// 2. Transformação (Aplicada ao valor FHIR)
								let transformationApplied = false;
								if (mapping.transformationType) {
									const transformResult = applyTransformation(
										sourceValue,
										mapping.transformationType,
										mapping.transformationDetails,
										fhirResource,
									);
									if (transformResult.success) {
										valueToSet = transformResult.value;
										transformationApplied = true;
									} else {
										itemErrors.push({
											fieldSourcePath: fhirPath,
											fieldTargetPath: targetPath,
											inputValue: sourceValue,
											errorType: 'Transformation',
											// biome-ignore lint/style/noNonNullAssertion: <explanation>
											message: transformResult.message!,
											details: {
												type: mapping.transformationType,
												details: mapping.transformationDetails,
											},
										});
										valueToSet = sourceValue; // Usa original se transformação falhar
									}
								} else {
									valueToSet = sourceValue; // Usa original se não houver transformação
								}

								// 3. Define o valor no item de saída
								if (
									(valueToSet !== undefined && valueToSet !== null) ||
									(transformationApplied &&
										mapping.transformationType?.toUpperCase() ===
											'DEFAULT_VALUE')
								) {
									if (config.sourceType === SourceType.CSV) {
										const columnName = targetPath.split('.')[0] || targetPath;
										outputItem[columnName] = valueToSet;
									} else {
										setValue(outputItem, targetPath, valueToSet);
									}
								}
							} // Fim if(fhirPath && targetPath)
						} // Fim loop fieldMappings
						resultItem = outputItem;
					} // Fim else (recurso válido)
				} // Fim if/else direction

				// --- Emissão para o Próximo Estágio ---
				if (itemErrors.length > 0) {
					// Emite um objeto de erro
					this.push({
						_isTransformError: true,
						errors: itemErrors,
						originalItem: chunk, // Envia o item original que causou o erro
					} as StreamItemError);
				} else if (resultItem !== null) {
					// Emite o item transformado com sucesso
					this.push(resultItem);
				}
				// else: Se resultItem for nulo e não houver erros (ex: FROM_FHIR com tipo errado), não emite nada

				callback(); // Sinaliza que este chunk foi processado (com ou sem emissão)
			} catch (error: any) {
				// Erro inesperado DENTRO da lógica de transformação do item
				console.error(
					'UNEXPECTED TRANSFORM STREAM ERROR:',
					error,
					'Item:',
					JSON.stringify(chunk).substring(0, 200),
				);
				// Emite um objeto de erro genérico para este item
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
				callback(); // Continua o stream, mas reporta o erro do item
				// Alternativa: callback(error) -> Pararia todo o pipeline
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
