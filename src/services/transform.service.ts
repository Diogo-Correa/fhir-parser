import {
	Direction,
	type FieldMapping,
	type Prisma,
	type FhirElementDefinition as PrismaFhirElementDefinition,
	type MappingConfiguration as PrismaMappingConfiguration,
	SourceType,
} from '@prisma/client';
import _ from 'lodash';
import { performance } from 'node:perf_hooks';
import { type Duplex, type Readable, Transform } from 'node:stream';
import {
	CACHE_PREFIXES,
	DEFAULT_CACHE_TTL as METADATA_CACHE_TTL,
	getOrSetCache,
} from '../lib/redis';
import { getMappingConfigurationByIdentifier as getMappingConfigFromDb } from '../repositories/mapping/getMappingConfiguration';
import {
	findElementsWithFixedOrDefaultValue as findElementsFixedDefaultFromDb,
	findFirstMandatoryStructureDefinitionByUrlOrType as findElementsMandatoryFromDb,
	findUniqueStructureDefinitionByUrlOrType as findFullSdFromDb,
} from '../repositories/structure-definitions/find-unique-sd';
import type { FieldProcessingError } from '../types/FieldProcessing';
import type {
	StreamTransformResult,
	StreamTransformServiceParams,
} from '../types/StreamTransform';
import type { FhirStructureDefinitionWithPaths } from '../types/StructureDefinition';
import { getValue } from '../utils/getValueByPath';
import { parseFhirStoredValue } from '../utils/parseFhirStored';
import { type SdElement, setValue } from '../utils/setValueByPath';
import {
	transformationRegistry,
	validationRegistry,
} from '../utils/transformation';
import { InvalidInputDataError } from './errors/InvalidInputDataError';
import { MappingConfigurationNotFoundError } from './errors/MappingConfigurationNotFoundError';
import { StructureDefinitionNotProcessedError } from './errors/StructureDefinitionNotProcessedError';
import { createFhirResourceStream } from './fhir.fetch.service';
import {
	createCsvParserStream,
	createJsonParserStream,
	createNdjsonStringifyStream,
} from './parser.service';

async function getCachedMappingConfiguration(
	identifier: string,
): Promise<
	(PrismaMappingConfiguration & { fieldMappings: FieldMapping[] }) | null
> {
	const cacheKey = `${CACHE_PREFIXES.MAPPING_CONFIG}${identifier}`;
	return getOrSetCache(
		cacheKey,
		() => getMappingConfigFromDb(identifier),
		METADATA_CACHE_TTL,
	);
}

async function getCachedFullStructureDefinition(
	url?: string | null,
	type?: string | null,
): Promise<FhirStructureDefinitionWithPaths | null> {
	if (!url && !type) return null;
	const cacheKeyPart = url ? `url:${encodeURIComponent(url)}` : `type:${type}`;
	const cacheKey = `${CACHE_PREFIXES.STRUCTURE_DEFINITION_WITH_ELEMENTS}${cacheKeyPart}`;
	return getOrSetCache(
		cacheKey,
		() => findFullSdFromDb(url, type),
		METADATA_CACHE_TTL,
	);
}

async function getCachedElementsFixedDefault(
	url?: string | null,
	type?: string | null,
): Promise<PrismaFhirElementDefinition[] | null> {
	if (!url && !type) return null;
	const cacheKeyPart = url ? `url:${encodeURIComponent(url)}` : `type:${type}`;
	const cacheKey = `${CACHE_PREFIXES.STRUCTURE_DEFINITION_FIXED_DEFAULT}${cacheKeyPart}`;
	const result = await getOrSetCache(
		cacheKey,
		() => findElementsFixedDefaultFromDb(url, type),
		METADATA_CACHE_TTL,
	);
	return result?.elements || null;
}

async function getCachedElementsMandatory(
	url?: string | null,
	type?: string | null,
): Promise<PrismaFhirElementDefinition[] | null> {
	if (!url && !type) return null;
	const cacheKeyPart = url ? `url:${encodeURIComponent(url)}` : `type:${type}`;
	const cacheKey = `${CACHE_PREFIXES.STRUCTURE_DEFINITION_MANDATORY}${cacheKeyPart}`;
	const result = await getOrSetCache(
		cacheKey,
		() => findElementsMandatoryFromDb(url, type),
		METADATA_CACHE_TTL,
	);
	return result?.elements || null;
}
interface TransformationMetadataBundle {
	mappingConfig: PrismaMappingConfiguration & { fieldMappings: FieldMapping[] };
	resourceType: string;
	structureDefinitionUrl?: string | null;
	sdAllElementsForPathResolution: SdElement[];
	sdElementsForAutoPopulation: PrismaFhirElementDefinition[];
	sdElementsForMandatoryCheck: PrismaFhirElementDefinition[];
}

export async function streamTransformData({
	mappingConfigName,
	inputStream,
	sourceContentType,
	fhirQueryPath,
	sendToFhir = false,
	fhirServerUrlOverride,
}: StreamTransformServiceParams): Promise<StreamTransformResult> {
	const overallStartTime = performance.now();

	const mappingConfig = await getCachedMappingConfiguration(mappingConfigName);
	if (!mappingConfig)
		throw new MappingConfigurationNotFoundError(mappingConfigName);

	const metadataLoadStartTime = performance.now();
	const bundle: TransformationMetadataBundle = {
		mappingConfig,
		resourceType: mappingConfig.fhirResourceType,
		structureDefinitionUrl: mappingConfig.structureDefinitionUrl,
		sdAllElementsForPathResolution: [],
		sdElementsForAutoPopulation: [],
		sdElementsForMandatoryCheck: [],
	};

	if (bundle.structureDefinitionUrl || bundle.resourceType) {
		const sdLogId = bundle.structureDefinitionUrl || bundle.resourceType;

		const fullSd = await getCachedFullStructureDefinition(
			bundle.structureDefinitionUrl,
			bundle.resourceType,
		);

		if (!fullSd || !fullSd.elements || fullSd.elements.length === 0)
			throw new StructureDefinitionNotProcessedError(sdLogId);

		bundle.sdAllElementsForPathResolution = fullSd.elements.map((el) => ({
			path: el.path,
			max: el.cardinalityMax,
		}));

		if (mappingConfig.direction === Direction.TO_FHIR) {
			bundle.sdElementsForAutoPopulation =
				(await getCachedElementsFixedDefault(
					bundle.structureDefinitionUrl,
					bundle.resourceType,
				)) || [];

			bundle.sdElementsForMandatoryCheck =
				(await getCachedElementsMandatory(
					bundle.structureDefinitionUrl,
					bundle.resourceType,
				)) || [];
		}
	}
	const metadataLoadEndTime = performance.now();

	let initialStream: Readable;
	let parserStream: Duplex | null = null;
	const transformStreamInstance: Transform = createFhirTransformStream(
		bundle,
		sendToFhir,
		fhirServerUrlOverride ?? undefined,
	);
	let outputSerializerStream: Transform;
	let outputContentType: string;

	if (mappingConfig.direction === Direction.TO_FHIR) {
		if (!inputStream) {
			throw new InvalidInputDataError(
				'Input stream is required for TO_FHIR direction when no inline data is provided.',
			);
		}
		initialStream = inputStream;
		if (sourceContentType?.includes('csv')) {
			if (mappingConfig.sourceType !== SourceType.CSV)
				throw new InvalidInputDataError(
					`Mapping '${mappingConfigName}' expects ${mappingConfig.sourceType} but received CSV stream.`,
				);
			parserStream = createCsvParserStream();
		} else if (
			sourceContentType?.includes('json') ||
			sourceContentType?.includes('ndjson')
		) {
			if (mappingConfig.sourceType !== SourceType.JSON)
				throw new InvalidInputDataError(
					`Mapping '${mappingConfigName}' expects ${mappingConfig.sourceType} but received JSON/NDJSON stream.`,
				);
			parserStream = createJsonParserStream();
		} else {
			throw new InvalidInputDataError(
				`Unsupported source Content-Type for TO_FHIR stream: ${sourceContentType}.`,
			);
		}
		outputSerializerStream = createNdjsonStringifyStream();
		outputContentType = 'application/x-ndjson';
	} else if (mappingConfig.direction === Direction.FROM_FHIR) {
		if (!fhirQueryPath) {
			throw new InvalidInputDataError(
				'fhirQueryPath parameter is required for FROM_FHIR direction.',
			);
		}
		initialStream = createFhirResourceStream({
			initialUrl: fhirQueryPath,
			fhirServerUrl: fhirServerUrlOverride ?? process.env.FHIR_SERVER_BASE_URL,
		});
		parserStream = null;
		outputSerializerStream = createNdjsonStringifyStream();
		outputContentType = 'application/x-ndjson';
	} else {
		throw new Error(
			`Unsupported transformation direction in mapping '${mappingConfigName}': ${mappingConfig.direction}`,
		);
	}

	const allProcessStreams: (Readable | Duplex | Transform)[] = [initialStream];
	if (parserStream) allProcessStreams.push(parserStream);
	allProcessStreams.push(transformStreamInstance);
	allProcessStreams.push(outputSerializerStream);

	let prevStream: Readable = initialStream;
	for (let i = 1; i < allProcessStreams.length; i++) {
		const currentStream = allProcessStreams[i];
		prevStream.on('error', (err) => {
			if (!finalOutputStream.destroyed) finalOutputStream.emit('error', err);
		});
		prevStream = prevStream.pipe(currentStream as NodeJS.WritableStream) as
			| Duplex
			| Transform;
	}
	const finalOutputStream: Readable =
		allProcessStreams[allProcessStreams.length - 1];

	return { outputStream: finalOutputStream, outputContentType };
}

function createFhirTransformStream(
	bundle: TransformationMetadataBundle,
	sendToFhir: boolean,
	fhirServerUrlOverride?: string,
): Transform {
	const {
		mappingConfig,
		resourceType,
		structureDefinitionUrl,
		sdAllElementsForPathResolution,
		sdElementsForAutoPopulation,
		sdElementsForMandatoryCheck,
	} = bundle;

	return new Transform({
		objectMode: true,
		writableHighWaterMark: 16,
		readableHighWaterMark: 16,
		async transform(chunk, encoding, callback) {
			const itemProcessStartTime = performance.now();
			const itemErrors: FieldProcessingError[] = [];
			const sourceItem = chunk;
			let outputItem: any = {};

			try {
				const mappedTargetPaths = new Set<string>();

				if (mappingConfig.direction === Direction.TO_FHIR) {
					outputItem = { resourceType: resourceType };
					if (structureDefinitionUrl) {
						setValue(
							outputItem,
							'meta.profile[0]',
							structureDefinitionUrl,
							sdAllElementsForPathResolution,
							resourceType,
						);
					}

					for (const mapping of mappingConfig.fieldMappings) {
						const currentPathInSource = mapping.sourcePath;
						const currentPathInTarget = mapping.targetFhirPath;
						if (!currentPathInTarget) continue;

						let valueFromSource: any;
						if (currentPathInSource && currentPathInSource !== '$ROOT') {
							valueFromSource = getValue(sourceItem, currentPathInSource);
						} else if (currentPathInSource === '$ROOT') {
							valueFromSource = sourceItem;
						}
						let valueToSet = valueFromSource;
						let fieldErrorFound = false;

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
								if (result.success) {
									valueToSet = result.value;
								} else {
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
								if (transformResult.success) {
									valueToSet = transformResult.value;
								} else {
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
							} else {
								setValue(
									outputItem,
									currentPathInTarget,
									valueToSet,
									sdAllElementsForPathResolution,
									resourceType,
								);
								mappedTargetPaths.add(currentPathInTarget.split('[')[0]);
							}
						}
					}

					if (
						itemErrors.length === 0 &&
						sdElementsForAutoPopulation.length > 0
					) {
						for (const elementDef of sdElementsForAutoPopulation) {
							const relativePath = elementDef.path.substring(
								resourceType.length + 1,
							);
							if (!relativePath || elementDef.path === resourceType) continue;

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
									sdAllElementsForPathResolution,
									resourceType,
								);
								mappedTargetPaths.add(pathBase);
							}
						}
					}

					if (
						itemErrors.length === 0 &&
						sdElementsForMandatoryCheck.length > 0
					) {
						for (const elementDef of sdElementsForMandatoryCheck) {
							const fullPathFromSD = elementDef.path;
							const relativePath = fullPathFromSD.substring(
								resourceType.length + 1,
							);

							if (!relativePath || fullPathFromSD === resourceType) continue;

							let checkThisField = true;
							const pathParts = relativePath.split('.');
							if (pathParts.length > 1) {
								const parentInstancePath = pathParts.slice(0, -1).join('.');
								const parentValueInOutput = getValue(
									outputItem,
									parentInstancePath,
								);
								if (
									parentValueInOutput === undefined ||
									parentValueInOutput === null ||
									(Array.isArray(parentValueInOutput) &&
										parentValueInOutput.length === 0)
								) {
									checkThisField = false;
								}
							}

							if (checkThisField) {
								const valueInOutput = getValue(outputItem, relativePath);
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
				} else if (mappingConfig.direction === Direction.FROM_FHIR) {
					const fhirResource = sourceItem;
					outputItem = {};

					if (!fhirResource || fhirResource?.resourceType !== resourceType) {
						itemErrors.push({
							fieldTargetPath: 'N/A',
							inputValue: fhirResource,
							errorType: 'Validation',
							message: `Expected '${resourceType}', got '${fhirResource?.resourceType}'. Skipping.`,
						});
					} else {
						for (const mapping of mappingConfig.fieldMappings) {
							const currentPathInSourceFhir = mapping.targetFhirPath;
							const currentPathInTargetSystem = mapping.sourcePath;
							if (!currentPathInTargetSystem || !currentPathInSourceFhir)
								continue;

							const valueFromFhir = getValue(
								fhirResource,
								currentPathInSourceFhir,
							);
							const valueToSetInTarget = valueFromFhir;

							// TODO: Considerar se validações/transformações de 'mapping' se aplicam na direção FROM_FHIR

							if (
								valueToSetInTarget !== undefined &&
								valueToSetInTarget !== null
							) {
								if (mappingConfig.sourceType === SourceType.CSV) {
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
				if (mappingConfig.direction === Direction.TO_FHIR) {
					finalItemToPush = outputItem;
				} else if (mappingConfig.direction === Direction.FROM_FHIR) {
					if (outputItem && Object.keys(outputItem).length > 0) {
						finalItemToPush = outputItem;
					}
				}

				if (itemErrors.length > 0) {
					this.push({
						type: 'error',
						error: {
							type: 'StreamItemError',
							errors: itemErrors,
							originalItem: sourceItem,
							_isTransformError: true,
						},
					});
				} else if (finalItemToPush) {
					if (
						mappingConfig.direction === Direction.FROM_FHIR &&
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

				this.push({
					type: 'error',
					error: {
						type: 'StreamProcessingError',
						message: `Unexpected system error during item transformation: ${errMessage}`,
						originalItem: sourceItem,
					},
				});
				callback();
			}
		},
	});
}
