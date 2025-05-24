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
	const mappingConfig = await getMappingConfigurationByName(mappingConfigName);

	let initialStream: Readable;
	let parserStream: Duplex | null = null;
	let transformStreamInstance: Transform;
	let outputSerializerStream: Transform;
	let outputContentType: string;

	if (mappingConfig?.direction === Direction.TO_FHIR) {
		if (!inputStream) {
			// sourceContentType é verificado pelo controller agora
			throw new InvalidInputDataError(
				'Input stream is required for TO_FHIR direction when no inline data is provided.',
			);
		}
		initialStream = inputStream;

		// O controller define sourceContentType. O parser é escolhido com base nele.
		if (sourceContentType?.includes('csv')) {
			if (mappingConfig?.sourceType !== SourceType.CSV)
				throw new InvalidInputDataError(
					`Mapping '${mappingConfigName}' expects ${mappingConfig?.sourceType} but received CSV stream.`,
				);
			parserStream = createCsvParserStream();
		} else if (
			sourceContentType?.includes('json') ||
			sourceContentType?.includes('ndjson')
		) {
			if (mappingConfig?.sourceType !== SourceType.JSON)
				throw new InvalidInputDataError(
					`Mapping '${mappingConfigName}' expects ${mappingConfig?.sourceType} but received JSON/NDJSON stream.`,
				);
			parserStream = createJsonParserStream();
		} else {
			// Este caso pode não ser alcançado se o controller validar Content-Type antes
			throw new InvalidInputDataError(
				`Unsupported source Content-Type for TO_FHIR stream: ${sourceContentType}.`,
			);
		}

		transformStreamInstance = createFhirTransformStream(
			mappingConfig,
			sendToFhir,
			fhirServerUrlOverride ?? undefined,
		);
		// Output is NDJSON because createFhirTransformStream emits {type:'data'/'error'} objects
		outputSerializerStream = createNdjsonStringifyStream();
		outputContentType = 'application/x-ndjson'; // Stream of JSON objects
	} else if (mappingConfig?.direction === Direction.FROM_FHIR) {
		if (!fhirQueryPath) {
			throw new InvalidInputDataError(
				'fhirQueryPath parameter is required for FROM_FHIR direction.',
			);
		}
		parserStream = null;
		initialStream = createFhirResourceStream({
			initialUrl: fhirQueryPath,
			fhirServerUrl: fhirServerUrlOverride ?? process.env.FHIR_SERVER_BASE_URL,
		});
		transformStreamInstance = createFhirTransformStream(
			mappingConfig,
			false,
			undefined,
		);
		// Output is NDJSON because createFhirTransformStream emits {type:'data'/'error'} objects
		// The controller will take this NDJSON stream and build the final JSON response.
		outputSerializerStream = createNdjsonStringifyStream();
		outputContentType = 'application/x-ndjson'; // Stream of JSON objects
	} else {
		throw new Error(
			`Unsupported transformation direction in mapping '${mappingConfigName}': ${mappingConfig?.direction}`,
		);
	}

	// Monta o Pipeline
	const allProcessStreams: (Readable | Duplex | Transform)[] = [initialStream];
	if (parserStream) {
		allProcessStreams.push(parserStream);
	}
	allProcessStreams.push(transformStreamInstance);
	allProcessStreams.push(outputSerializerStream);

	// Cria o pipeline manualmente e propaga erros para o stream final
	let prevStream: Readable = initialStream;
	for (let i = 1; i < allProcessStreams.length; i++) {
		const currentStream = allProcessStreams[i];
		// Propaga erros do stream anterior para o stream final
		prevStream.on('error', (err) => {
			allProcessStreams[allProcessStreams.length - 1].emit('error', err);
		});
		// Faz cast para Duplex | Transform, pois pipe retorna o próprio stream para esses casos
		prevStream = prevStream.pipe(currentStream as NodeJS.WritableStream) as
			| Duplex
			| Transform;
	}

	const finalOutputStream: Readable =
		allProcessStreams[allProcessStreams.length - 1];

	finalOutputStream.on('error', (err) => {
		console.error(
			`STREAM PIPELINE ERROR for mapping '${mappingConfigName}':`,
			err?.message,
			err?.stack,
		);
	});

	return {
		outputStream: finalOutputStream,
		outputContentType: outputContentType,
	};
}

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
				} // Para FROM_FHIR, outputItem começa vazio {}

				// --- Processa cada mapeamento de campo ---
				for (const mapping of config.fieldMappings) {
					let valueFromSource: any;
					let currentPathInSource: string;
					let currentPathInTarget: string;
					let fieldErrorFound = false;

					if (config.direction === Direction.TO_FHIR) {
						currentPathInSource = mapping.sourcePath;
						currentPathInTarget = mapping.targetFhirPath;
						valueFromSource = getValue(sourceItem, currentPathInSource);
					} else {
						// FROM_FHIR
						currentPathInSource = mapping.targetFhirPath;
						currentPathInTarget = mapping.sourcePath;
						valueFromSource = getValue(sourceItem, currentPathInSource);
					}

					if (!currentPathInTarget) {
						console.warn(
							`[Transform Service] Mapping field for source '${currentPathInSource}' is missing a target path for mapping '${config.name}'. Skipping.`,
						);
						continue;
					}

					let valueToSet = valueFromSource;

					// 1. Tratamento Especial: DEFAULT_VALUE
					if (
						(valueToSet === null || valueToSet === undefined) &&
						mapping.transformationType?.toUpperCase() === 'DEFAULT_VALUE'
					) {
						const defaultFunc = transformationRegistry.get('DEFAULT_VALUE');
						if (defaultFunc) {
							const result = defaultFunc(null, mapping.transformationDetails, {
								sourceItem,
							});
							if (result.success) {
								valueToSet = result.value;
							} else {
								itemErrors.push({
									fieldSourcePath: currentPathInSource,
									fieldTargetPath: currentPathInTarget,
									inputValue: valueFromSource,
									errorType: 'Transformation',
									message: result.message || 'Failed to apply default value',
									details: { type: 'DEFAULT_VALUE' },
								});
								fieldErrorFound = true;
							}
						} else {
							const errMsg =
								'DEFAULT_VALUE transformation function not registered.';
							itemErrors.push({
								fieldSourcePath: currentPathInSource,
								fieldTargetPath: currentPathInTarget,
								inputValue: valueFromSource,
								errorType: 'Transformation',
								message: errMsg,
							});
							fieldErrorFound = true;
						}
					}

					// 2. Validação
					if (!fieldErrorFound && mapping.validationType) {
						if (
							mapping.validationType.toUpperCase() === 'REQUIRED' ||
							(valueToSet !== null &&
								valueToSet !== undefined &&
								String(valueToSet).trim() !== '')
						) {
							const validationFunc = validationRegistry.get(
								mapping.validationType.toUpperCase(),
							);
							if (validationFunc) {
								const validationErrorMsg = validationFunc(
									valueToSet,
									mapping.validationDetails,
									{ sourceItem },
								);
								if (validationErrorMsg) {
									itemErrors.push({
										fieldSourcePath: currentPathInSource,
										fieldTargetPath: currentPathInTarget,
										inputValue: valueToSet,
										errorType: 'Validation',
										message: validationErrorMsg,
										details: {
											type: mapping.validationType,
											details: mapping.validationDetails,
										},
									});
									fieldErrorFound = true;
								}
							} else {
								const errMsg = `Validation function '${mapping.validationType}' not registered.`;
								itemErrors.push({
									fieldSourcePath: currentPathInSource,
									fieldTargetPath: currentPathInTarget,
									inputValue: valueToSet,
									errorType: 'Validation',
									message: errMsg,
								});
								fieldErrorFound = true;
							}
						} else if (
							mapping.validationType.toUpperCase() !== 'REQUIRED' &&
							(valueToSet === null ||
								valueToSet === undefined ||
								String(valueToSet).trim() === '')
						) {
							// Se não for REQUIRED e o valor for vazio/nulo, não valida (a menos que o próprio valor seja o problema para REQUIRED)
						}
					}

					// 3. Transformação
					if (
						!fieldErrorFound &&
						mapping.transformationType &&
						mapping.transformationType.toUpperCase() !== 'DEFAULT_VALUE'
					) {
						const transformationFunc = transformationRegistry.get(
							mapping.transformationType.toUpperCase(),
						);
						if (transformationFunc) {
							const transformResult = transformationFunc(
								valueToSet,
								mapping.transformationDetails,
								{ sourceItem },
							);
							if (transformResult.success) valueToSet = transformResult.value;
							else {
								itemErrors.push({
									fieldSourcePath: currentPathInSource,
									fieldTargetPath: currentPathInTarget,
									inputValue: valueToSet,
									errorType: 'Transformation',
									message:
										transformResult.message ||
										`Transformation '${mapping.transformationType}' failed.`,
									details: {
										type: mapping.transformationType,
										details: mapping.transformationDetails,
									},
								});
								fieldErrorFound = true;
							}
						} else {
							const errMsg = `Transformation function '${mapping.transformationType}' not registered.`;
							itemErrors.push({
								fieldSourcePath: currentPathInSource,
								fieldTargetPath: currentPathInTarget,
								inputValue: valueToSet,
								errorType: 'Transformation',
								message: errMsg,
							});
							fieldErrorFound = true;
						}
					}

					// 4. Define o valor final no item de saída
					if (
						!fieldErrorFound &&
						((valueToSet !== undefined && valueToSet !== null) ||
							(mapping.transformationType?.toUpperCase() === 'DEFAULT_VALUE' &&
								valueToSet !== undefined))
					) {
						if (
							config.direction === Direction.FROM_FHIR &&
							config.sourceType === SourceType.CSV
						) {
							const columnName =
								currentPathInTarget.split('.')[0] || currentPathInTarget;
							outputItem[columnName] = valueToSet;
						} else setValue(outputItem, currentPathInTarget, valueToSet);
					}
				} // Fim do loop de fieldMappings

				// Define resultItem
				if (config.direction === Direction.TO_FHIR) {
					resultItem = outputItem;
					if (itemErrors.length === 0 && resultItem && sendToFhir)
						sendResourceToFhirServer({
							resource: resultItem,
							resourceType: config.fhirResourceType,
							fhirServerUrl: fhirServerUrlOverride,
						});
				} else {
					// FROM_FHIR
					if (Object.keys(outputItem).length > 0 || itemErrors.length > 0)
						resultItem = outputItem;
					else resultItem = null;
				}

				// Emissão
				if (itemErrors.length > 0) {
					this.push({
						type: 'error',
						error: {
							errors: itemErrors,
							originalItem: chunk,
						} as StreamItemError, // Cast to StreamItemError for type consistency if used elsewhere
					});
				} else if (resultItem !== null) {
					this.push({ type: 'data', item: resultItem });
				}
				callback();
			} catch (error: any) {
				console.error(
					'UNEXPECTED ERROR IN TRANSFORM STREAM ITEM PROCESSING:',
					error,
					'Item (partial):',
					JSON.stringify(chunk).substring(0, 200),
				);
				this.push({
					type: 'error',
					error: {
						errors: [
							{
								fieldTargetPath: 'N/A',
								inputValue: chunk,
								errorType: 'Transformation',
								message: `Unexpected system error processing item: ${error.message}`,
							},
						],
						originalItem: chunk,
					} as StreamItemError, // Cast to StreamItemError for type consistency
				});
				callback();
			}
		},
	});
}
