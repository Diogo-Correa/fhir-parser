import {
	Direction,
	type FieldMapping,
	type MappingConfiguration,
	type Prisma,
	SourceType,
} from '@prisma/client';
import _ from 'lodash';
import { type Duplex, type Readable, Transform } from 'node:stream';
import { getMappingConfigurationByName } from '../repositories/mapping/getMappingConfiguration';
import {
	findElementsWithFixedOrDefaultValue,
	findFirstMandatoryStructureDefinitionByUrlOrType,
	findUniqueStructureDefinitionByUrlOrType,
} from '../repositories/structure-definitions/find-unique-sd';
import type { FieldProcessingError } from '../types/FieldProcessing';
import type {
	StreamItemError,
	StreamTransformResult,
	StreamTransformServiceParams,
} from '../types/StreamTransform';
import { getValue } from '../utils/getValueByPath';
import { parseFhirStoredValue } from '../utils/parseFhirStored';
import { type SdElement, setValue } from '../utils/setValueByPath';
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
			const sourceItem = chunk;
			let outputItem: any = {};

			try {
				const mappedTargetPaths = new Set<string>();

				let COMPLETE_SD_ELEMENTS: SdElement[] = [];
				const resourceTypeForElementPaths: string = config.fhirResourceType;

				if (config.structureDefinitionUrl || config.fhirResourceType) {
					const fullSdForContext =
						await findUniqueStructureDefinitionByUrlOrType(
							config.structureDefinitionUrl,
							config.fhirResourceType,
						);
					if (fullSdForContext?.elements) {
						COMPLETE_SD_ELEMENTS = fullSdForContext.elements.map((el) => ({
							path: el.path,
							max: el.cardinalityMax,
						}));
					}
				}

				if (config.direction === Direction.TO_FHIR) {
					outputItem = { resourceType: config.fhirResourceType };

					if (config.structureDefinitionUrl) {
						setValue(
							outputItem,
							'meta.profile[0]',
							config.structureDefinitionUrl,
							COMPLETE_SD_ELEMENTS,
							resourceTypeForElementPaths,
						);
					}

					// 1. Aplicar mapeamentos definidos pelo usuário
					for (const mapping of config.fieldMappings) {
						const currentPathInSource = mapping.sourcePath;
						const currentPathInTarget = mapping.targetFhirPath;
						if (!currentPathInTarget) continue;

						const valueFromSource =
							currentPathInSource === '$ROOT'
								? sourceItem
								: getValue(sourceItem, currentPathInSource);
						let valueToSet = valueFromSource;
						let fieldErrorFound = false;

						// 1a. DEFAULT_VALUE
						if (
							(valueToSet === null || valueToSet === undefined) &&
							mapping.transformationType?.toUpperCase() === 'DEFAULT_VALUE'
						) {
							const defaultFunc = transformationRegistry.get('DEFAULT_VALUE');
							if (defaultFunc) {
								const result = defaultFunc(
									null,
									mapping.transformationDetails,
									{ sourceItem },
								);
								if (result.success) valueToSet = result.value;
								else {
									itemErrors.push({
										fieldSourcePath: currentPathInSource,
										fieldTargetPath: currentPathInTarget,
										inputValue: valueFromSource,
										errorType: 'Transformation',
										message: result.message || 'Failed to apply default value',
										details: {
											type: 'DEFAULT_VALUE',
											details:
												mapping.transformationDetails as Prisma.JsonObject,
										},
									});
									fieldErrorFound = true;
								}
							} else {
								itemErrors.push({
									fieldSourcePath: currentPathInSource,
									fieldTargetPath: currentPathInTarget,
									inputValue: valueFromSource,
									errorType: 'Transformation',
									message: 'DEFAULT_VALUE function not registered.',
								});
								fieldErrorFound = true;
							}
						}

						// 1b. Validação
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
												details: mapping.validationDetails as Prisma.JsonObject,
											},
										});
										fieldErrorFound = true;
									}
								} else {
									itemErrors.push({
										fieldSourcePath: currentPathInSource,
										fieldTargetPath: currentPathInTarget,
										inputValue: valueToSet,
										errorType: 'Validation',
										message: `Validation function '${mapping.validationType}' not registered.`,
									});
									fieldErrorFound = true;
								}
							}
						}

						// 1c. Transformação
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
											details:
												mapping.transformationDetails as Prisma.JsonObject,
										},
									});
									fieldErrorFound = true;
								}
							} else {
								itemErrors.push({
									fieldSourcePath: currentPathInSource,
									fieldTargetPath: currentPathInTarget,
									inputValue: valueToSet,
									errorType: 'Transformation',
									message: `Transformation function '${mapping.transformationType}' not registered.`,
								});
								fieldErrorFound = true;
							}
						}

						// 1d. Definir valor no outputItem
						if (
							!fieldErrorFound &&
							((valueToSet !== undefined && valueToSet !== null) ||
								(mapping.transformationType?.toUpperCase() ===
									'DEFAULT_VALUE' &&
									valueToSet !== undefined))
						) {
							if (
								valueToSet === undefined &&
								!(mapping.transformationType?.toUpperCase() === 'DEFAULT_VALUE')
							) {
								// Não setar se for undefined e não for resultado de DEFAULT_VALUE
							} else {
								setValue(
									outputItem,
									currentPathInTarget,
									valueToSet,
									COMPLETE_SD_ELEMENTS, // Passa a SD COMPLETA
									resourceTypeForElementPaths,
								);
								mappedTargetPaths.add(currentPathInTarget.split('[')[0]);
							}
						}
					}

					// Início da Lógica de Auto-População (Passo 2) ---
					// Só executa se não houver erros do Passo 1 e se tivermos informações da SD.
					if (itemErrors.length === 0 && COMPLETE_SD_ELEMENTS.length > 0) {
						const sdIdentifierAutoPop =
							config.structureDefinitionUrl || config.fhirResourceType;
						const sdInfoForAutoPopulationLoop =
							await findElementsWithFixedOrDefaultValue(sdIdentifierAutoPop);

						if (sdInfoForAutoPopulationLoop?.elements) {
							for (const elementDef of sdInfoForAutoPopulationLoop.elements) {
								const relativePath = elementDef.path.substring(
									config.fhirResourceType.length + 1,
								);
								if (
									!relativePath ||
									elementDef.path === config.fhirResourceType
								)
									continue;

								const pathBase = relativePath.split('[')[0];
								const valueAlreadyPresent =
									mappedTargetPaths.has(pathBase) ||
									getValue(outputItem, relativePath) !== undefined;

								if (valueAlreadyPresent) continue;

								let valueToAutoSet: any;
								if (elementDef.fixedValue !== null) {
									valueToAutoSet = parseFhirStoredValue(
										elementDef.fixedValue,
										elementDef.fixedValueType || elementDef.dataTypes?.[0],
									);
								} else if (elementDef.defaultValue !== null) {
									valueToAutoSet = parseFhirStoredValue(
										elementDef.defaultValue,
										elementDef.defaultValueType || elementDef.dataTypes?.[0],
									);
								}

								if (valueToAutoSet !== undefined) {
									setValue(
										outputItem,
										relativePath,
										valueToAutoSet,
										COMPLETE_SD_ELEMENTS,
										resourceTypeForElementPaths,
									);
									mappedTargetPaths.add(pathBase);
								}
							}
						}
					}

					// Checagem Final de Campos Obrigatórios (Passo 3) ---
					// Só executa se não houver erros dos Passos 1 e 2 e se tivermos informações da SD.
					if (itemErrors.length === 0 && COMPLETE_SD_ELEMENTS.length > 0) {
						const sdIdentifierForFinalCheck =
							config.structureDefinitionUrl || config.fhirResourceType;
						const sdInfoForFinalCheck =
							await findFirstMandatoryStructureDefinitionByUrlOrType(
								sdIdentifierForFinalCheck,
							);

						if (sdInfoForFinalCheck?.elements) {
							for (const elementDef of sdInfoForFinalCheck.elements) {
								const relativePath = elementDef.path.substring(
									config.fhirResourceType.length + 1,
								);
								if (
									!relativePath ||
									elementDef.path === config.fhirResourceType
								)
									continue;

								let valueInOutput: any;
								const pathParts = relativePath.split('.');
								if (pathParts.length > 1) {
									const potentialArrayPath = pathParts.slice(0, -1).join('.');
									const propertyInArrayElement =
										pathParts[pathParts.length - 1];
									const arrayCandidate = getValue(
										outputItem,
										potentialArrayPath,
									);
									if (
										Array.isArray(arrayCandidate) &&
										arrayCandidate.length > 0
									) {
										valueInOutput = getValue(
											arrayCandidate[0],
											propertyInArrayElement,
										);
									} else if (
										Array.isArray(arrayCandidate) &&
										arrayCandidate.length === 0
									) {
										valueInOutput = undefined;
									} else {
										valueInOutput = getValue(outputItem, relativePath);
									}
								} else {
									valueInOutput = getValue(outputItem, relativePath);
								}

								const isArrayActuallyEmpty =
									Array.isArray(valueInOutput) && valueInOutput.length === 0;

								if (
									valueInOutput === undefined ||
									valueInOutput === null ||
									isArrayActuallyEmpty
								) {
									const basePathForErrorCheck = relativePath.split('[')[0];
									if (
										!itemErrors.some((e) =>
											e.fieldTargetPath?.startsWith(basePathForErrorCheck),
										)
									) {
										itemErrors.push({
											fieldSourcePath: 'N/A (FHIR Profile Post-check)',
											fieldTargetPath: relativePath,
											inputValue:
												valueInOutput === undefined
													? 'undefined'
													: JSON.stringify(valueInOutput),
											errorType: 'Validation',
											message: `Mandatory FHIR element '${relativePath}' (min: ${elementDef.cardinalityMin}) is missing, null, or an empty array in the final resource.`,
											details: {
												rule: `cardinalityMin: ${elementDef.cardinalityMin}`,
											},
										});
									}
								}
							}
						}
					}
				} else if (config.direction === Direction.FROM_FHIR) {
					const fhirResource = sourceItem;
					outputItem = {};

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
					} else {
						for (const mapping of config.fieldMappings) {
							const currentPathInSourceFhir = mapping.targetFhirPath;
							const currentPathInTargetSystem = mapping.sourcePath;
							if (!currentPathInTargetSystem || !currentPathInSourceFhir)
								continue;

							const valueFromFhir = getValue(
								fhirResource,
								currentPathInSourceFhir,
							);
							const valueToSetInTarget = valueFromFhir;

							if (
								valueToSetInTarget !== undefined &&
								valueToSetInTarget !== null
							) {
								if (config.sourceType === SourceType.CSV) {
									const columnName =
										currentPathInTargetSystem.split('.')[0] ||
										currentPathInTargetSystem;
									outputItem[columnName] = valueToSetInTarget;
								} else {
									_.set(
										outputItem,
										currentPathInTargetSystem,
										valueToSetInTarget,
									);
								}
							}
						}
					}
				}

				let finalItemToPush: any = null;
				if (config.direction === Direction.TO_FHIR) {
					finalItemToPush = outputItem;
				} else if (config.direction === Direction.FROM_FHIR) {
					if (outputItem && Object.keys(outputItem).length > 0) {
						finalItemToPush = outputItem;
					}
				}

				if (itemErrors.length > 0) {
					this.push({
						type: 'error',
						error: {
							errors: itemErrors,
							originalItem: sourceItem,
						} as StreamItemError,
					});
				} else if (finalItemToPush) {
					if (
						config.direction === Direction.FROM_FHIR &&
						Object.keys(finalItemToPush).length === 0 &&
						!Array.isArray(finalItemToPush)
					) {
					} else {
						this.push({ type: 'data', item: finalItemToPush });
					}
				}
				callback();
			} catch (error: any) {
				const errMessage =
					error instanceof Error ? error.message : String(error);
				console.error(
					`UNEXPECTED ERROR in transform for mapping '${config.name}': ${errMessage}`,
					error.stack,
					'Problematic Item (first 200 chars):',
					String(sourceItem).substring(0, 200),
				);
				this.push({
					type: 'error',
					error: {
						errors: [
							{
								fieldTargetPath: 'N/A (System Error)',
								inputValue: sourceItem,
								errorType: 'Transformation',
								message: `Unexpected system error: ${errMessage}`,
							},
						],
						originalItem: sourceItem,
					} as StreamItemError,
				});
				callback();
			}
		},
	});
}
