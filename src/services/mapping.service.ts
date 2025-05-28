import {
	Direction,
	type FhirElementDefinition,
	type FieldMapping,
	type MappingConfiguration,
	Prisma,
} from '@prisma/client';
import { createMappingConfigurationWithFields } from '../repositories/mapping/createMappingConfiguration';
import { deleteMappingConfigurationByIdentifier as deleteMappingConfigurationRepo } from '../repositories/mapping/deleteMappingConfiguration';
import { getAllMappingConfigurations as getAllMappingConfigurationsRepo } from '../repositories/mapping/getAllMappingConfigurations';
import { updateMappingConfigurationWithFields } from '../repositories/mapping/updateMappingConfiguration';

import { getMappingConfigurationByIdentifier } from '../repositories/mapping/getMappingConfiguration';
import { findUniqueStructureDefinitionByUrlOrType } from '../repositories/structure-definitions/find-unique-sd';
import type {
	CreateMappingConfigurationInput,
	UpdateMappingConfigurationInput,
} from '../schemas/mapping.schema';
import type { FhirStructureDefinitionWithPaths } from '../types/StructureDefinition';
import { isValidFhirPath } from '../utils/fhirPath';
import { parseFhirStoredValue } from '../utils/parseFhirStored';
import { InvalidMappingError } from './errors/InvalidMappingError';
import { MappingConfigurationNotFoundError } from './errors/MappingConfigurationNotFoundError';
import { StructureDefinitionNotProcessedError } from './errors/StructureDefinitionNotProcessedError';

type ElementDefinitionForValidation = Pick<
	FhirElementDefinition,
	| 'path'
	| 'cardinalityMin'
	| 'fixedValue'
	| 'fixedValueType'
	| 'defaultValue'
	| 'defaultValueType'
	| 'dataTypes'
>;

export async function validateMappingAgainstStructureDefinition(
	mappingName: string,
	fhirResourceType: string,
	structureDefinitionUrl: string | null | undefined,
	fieldMappings: Array<
		Pick<
			FieldMapping,
			'targetFhirPath' | 'transformationType' | 'transformationDetails'
		>
	>,
	direction: Direction,
): Promise<void> {
	const validationSdIdentifier = structureDefinitionUrl || fhirResourceType;
	if (!validationSdIdentifier) {
		throw new Error(
			`Mapping configuration '${mappingName}' is incomplete for validation (missing structureDefinitionUrl and fhirResourceType).`,
		);
	}

	let targetStructureDefinition: FhirStructureDefinitionWithPaths | null = null;
	if (structureDefinitionUrl || fhirResourceType) {
		targetStructureDefinition = await findUniqueStructureDefinitionByUrlOrType(
			structureDefinitionUrl ?? null,
			fhirResourceType ?? null,
		);
	}

	if (
		!targetStructureDefinition ||
		targetStructureDefinition.elements.length === 0
	) {
		const id = structureDefinitionUrl || `type '${fhirResourceType}'`;
		throw new StructureDefinitionNotProcessedError(id);
	}

	const allElementsFromSD: ElementDefinitionForValidation[] =
		targetStructureDefinition.elements as ElementDefinitionForValidation[];
	const relativeValidPathsFromSD = new Set<string>(
		allElementsFromSD.map((el) =>
			el.path.startsWith(`${fhirResourceType}.`)
				? el.path.substring(fhirResourceType.length + 1)
				: el.path,
		),
	);

	for (const fieldMapping of fieldMappings) {
		const userMappedPath = fieldMapping.targetFhirPath;

		if (!isValidFhirPath(userMappedPath, relativeValidPathsFromSD)) {
			throw new InvalidMappingError(
				mappingName,
				`Path '${userMappedPath}'`,
				targetStructureDefinition.url,
			);
		}

		const fullPathInSD = `${fhirResourceType}.${userMappedPath.split('[')[0]}`;
		const elementDefForUserPath = allElementsFromSD.find(
			(el) =>
				el.path === fullPathInSD || el.path.startsWith(`${fullPathInSD}:`),
		);

		if (elementDefForUserPath && elementDefForUserPath.fixedValue !== null) {
			const fixedValFromSD = parseFhirStoredValue(
				elementDefForUserPath.fixedValue,
				elementDefForUserPath.fixedValueType ||
					elementDefForUserPath.dataTypes[0],
			);
			let userMappedValueViaDefault: any;

			if (
				fieldMapping.transformationType?.toUpperCase() === 'DEFAULT_VALUE' &&
				fieldMapping.transformationDetails
			) {
				userMappedValueViaDefault = (
					fieldMapping.transformationDetails as Prisma.JsonObject
				)?.value;
			}

			if (
				!(
					fieldMapping.transformationType?.toUpperCase() === 'DEFAULT_VALUE' &&
					userMappedValueViaDefault !== undefined &&
					JSON.stringify(userMappedValueViaDefault) ===
						JSON.stringify(fixedValFromSD)
				)
			) {
				throw new InvalidMappingError(
					mappingName,
					`Path '${userMappedPath}' maps to an element with a fixedValue ('${fixedValFromSD}') in StructureDefinition '${targetStructureDefinition.url}'. It should not be mapped or mapped differently.`,
					targetStructureDefinition.url,
				);
			}
		}
	}

	if (direction === Direction.TO_FHIR) {
		const mandatoryElementsInSD = allElementsFromSD.filter(
			(el) => (el.cardinalityMin ?? 0) >= 1 && el.fixedValue === null,
		);

		for (const mandatoryElement of mandatoryElementsInSD) {
			const relativeMandatoryPath = mandatoryElement.path.startsWith(
				`${fhirResourceType}.`,
			)
				? mandatoryElement.path.substring(fhirResourceType.length + 1)
				: mandatoryElement.path;

			if (!relativeMandatoryPath || mandatoryElement.path === fhirResourceType)
				continue;

			const baseMandatoryPath = relativeMandatoryPath.split('[')[0];
			const isMappedByUser = fieldMappings.some((fm) =>
				fm.targetFhirPath.startsWith(baseMandatoryPath),
			);

			if (!isMappedByUser && mandatoryElement.defaultValue === null) {
				throw new InvalidMappingError(
					mappingName,
					`Mandatory element '${relativeMandatoryPath}' (min: ${mandatoryElement.cardinalityMin}, no fixed/default value in SD) must be mapped for TO_FHIR direction.`,
					targetStructureDefinition.url,
				);
			}
		}
	}
}

export async function createMappingConfigService(
	input: CreateMappingConfigurationInput,
) {
	const { fieldMappings, ...mappingConfigData } = input;

	const existingByName = await getMappingConfigurationByIdentifier(
		mappingConfigData.name,
	);
	if (existingByName)
		throw new Error(
			`MappingConfiguration with name '${mappingConfigData.name}' already exists.`,
		);

	const fieldMappingsForValidation = fieldMappings.map((fm) => ({
		targetFhirPath: fm.targetFhirPath,
		transformationType: fm.transformationType || null,
		transformationDetails:
			(fm.transformationDetails as Prisma.JsonValue) || null,
	}));

	await validateMappingAgainstStructureDefinition(
		mappingConfigData.name,
		mappingConfigData.fhirResourceType,
		mappingConfigData.structureDefinitionUrl,
		fieldMappingsForValidation,
		mappingConfigData.direction,
	);

	const prismaFieldMappings = fieldMappings.map((fm) => ({
		sourcePath: fm.sourcePath,
		targetFhirPath: fm.targetFhirPath,
		validationType: fm.validationType,
		validationDetails:
			(fm.validationDetails as Prisma.JsonValue) ?? Prisma.DbNull,
		transformationType: fm.transformationType,
		transformationDetails:
			(fm.transformationDetails as Prisma.JsonValue) ?? Prisma.DbNull,
	}));

	return createMappingConfigurationWithFields(
		mappingConfigData,
		prismaFieldMappings,
	);
}

export async function getAllMappingConfigsService(includeFields = false) {
	return getAllMappingConfigurationsRepo(includeFields);
}

export async function getMappingConfigByIdentifierService(identifier: string) {
	const mappingConfig = await getMappingConfigurationByIdentifier(identifier);

	if (!mappingConfig) {
		throw new MappingConfigurationNotFoundError(identifier);
	}

	// await validateMappingAgainstStructureDefinition(
	// 	mappingConfig.name,
	// 	mappingConfig.fhirResourceType,
	// 	mappingConfig.structureDefinitionUrl,
	// 	mappingConfig.fieldMappings,
	// 	mappingConfig.direction,
	// );

	return mappingConfig;
}

export async function getMappingByNameService(name: string) {
	return getMappingConfigByIdentifierService(name);
}

export async function updateMappingConfigService(
	identifier: string,
	input: UpdateMappingConfigurationInput,
) {
	const { fieldMappings: newFieldMappingsInput, ...configUpdateData } = input;

	const existingConfig = await getMappingConfigurationByIdentifier(identifier);
	if (!existingConfig) {
		throw new MappingConfigurationNotFoundError(identifier);
	}

	if (configUpdateData.name && configUpdateData.name !== existingConfig.name) {
		const otherConfigWithName = await getMappingConfigurationByIdentifier(
			configUpdateData.name,
		);
		if (otherConfigWithName && otherConfigWithName.id !== existingConfig.id) {
			throw new Error(
				`Another MappingConfiguration with name '${configUpdateData.name}' already exists.`,
			);
		}
	}

	const finalName = configUpdateData.name ?? existingConfig.name;
	const finalFhirResourceType =
		configUpdateData.fhirResourceType ?? existingConfig.fhirResourceType;
	const finalStructureDefinitionUrl =
		configUpdateData.structureDefinitionUrl === null
			? null
			: (configUpdateData.structureDefinitionUrl ??
				existingConfig.structureDefinitionUrl);
	const finalDirection = configUpdateData.direction ?? existingConfig.direction;

	const fieldMappingsForValidation = newFieldMappingsInput
		? newFieldMappingsInput.map((fm) => ({
				targetFhirPath: fm.targetFhirPath,
				transformationType: fm.transformationType || null,
				transformationDetails:
					(fm.transformationDetails as Prisma.JsonValue) || null,
			}))
		: existingConfig.fieldMappings;

	await validateMappingAgainstStructureDefinition(
		finalName,
		finalFhirResourceType,
		finalStructureDefinitionUrl,
		fieldMappingsForValidation,
		finalDirection,
	);

	const prismaConfigUpdateData: Partial<MappingConfiguration> = {};
	if (configUpdateData.name !== undefined)
		prismaConfigUpdateData.name = configUpdateData.name;
	if (configUpdateData.description !== undefined)
		prismaConfigUpdateData.description = configUpdateData.description;
	if (configUpdateData.sourceType !== undefined)
		prismaConfigUpdateData.sourceType = configUpdateData.sourceType;
	if (configUpdateData.direction !== undefined)
		prismaConfigUpdateData.direction = configUpdateData.direction;
	if (configUpdateData.fhirResourceType !== undefined)
		prismaConfigUpdateData.fhirResourceType = configUpdateData.fhirResourceType;
	if (configUpdateData.structureDefinitionUrl !== undefined)
		prismaConfigUpdateData.structureDefinitionUrl =
			configUpdateData.structureDefinitionUrl;

	let prismaNewFieldMappings:
		| Omit<Prisma.FieldMappingCreateManyInput, 'mappingConfigurationId'>[]
		| undefined = undefined;
	if (newFieldMappingsInput !== undefined) {
		prismaNewFieldMappings = newFieldMappingsInput.map((fm) => ({
			sourcePath: fm.sourcePath,
			targetFhirPath: fm.targetFhirPath,
			validationType: fm.validationType,
			validationDetails:
				(fm.validationDetails as Prisma.JsonValue) ?? Prisma.DbNull,
			transformationType: fm.transformationType,
			transformationDetails:
				(fm.transformationDetails as Prisma.JsonValue) ?? Prisma.DbNull,
		}));
	}

	if (
		Object.keys(prismaConfigUpdateData).length === 0 &&
		prismaNewFieldMappings === undefined
	) {
		return existingConfig;
	}

	return updateMappingConfigurationWithFields(
		identifier,
		prismaConfigUpdateData,
		prismaNewFieldMappings,
	);
}

export async function deleteMappingConfigService(identifier: string) {
	const existingConfig = await getMappingConfigurationByIdentifier(identifier);
	if (!existingConfig) {
		throw new MappingConfigurationNotFoundError(identifier);
	}
	const deleted = await deleteMappingConfigurationRepo(identifier);
	if (!deleted) {
		throw new MappingConfigurationNotFoundError(identifier);
	}
	return deleted;
}
