import {
	Direction,
	type FhirElementDefinition,
	type Prisma,
} from '@prisma/client';
import { getMappingConfigurationByName } from '../repositories/mapping/getMappingConfiguration';
import { findUniqueStructureDefinitionByUrlOrType } from '../repositories/structure-definitions/find-unique-sd';
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

export async function getMappingByNameService(name: string) {
	const mappingConfig = await getMappingConfigurationByName(name);

	if (!mappingConfig) {
		throw new MappingConfigurationNotFoundError(name);
	}

	// 2. Determina a StructureDefinition para validação
	const validationSdIdentifier =
		mappingConfig.structureDefinitionUrl || mappingConfig.fhirResourceType;
	if (!validationSdIdentifier) {
		throw new Error(
			`Mapping configuration '${name}' is incomplete for validation (missing structureDefinitionUrl and fhirResourceType).`,
		);
	}

	// 3. Busca os elementos da StructureDefinition correspondente
	let targetStructureDefinition: FhirStructureDefinitionWithPaths | null = null;
	if (mappingConfig.structureDefinitionUrl || mappingConfig.fhirResourceType)
		targetStructureDefinition = await findUniqueStructureDefinitionByUrlOrType(
			mappingConfig.structureDefinitionUrl ?? null,
			mappingConfig.fhirResourceType ?? null,
		);

	if (
		!targetStructureDefinition ||
		targetStructureDefinition.elements.length === 0
	) {
		const id =
			mappingConfig.structureDefinitionUrl ||
			`type '${mappingConfig.fhirResourceType}'`;
		throw new StructureDefinitionNotProcessedError(id);
	}

	const allElementsFromSD: ElementDefinitionForValidation[] =
		targetStructureDefinition.elements as ElementDefinitionForValidation[];
	const relativeValidPathsFromSD = new Set<string>(
		allElementsFromSD.map((el) =>
			el.path.startsWith(`${mappingConfig.fhirResourceType}.`)
				? el.path.substring(mappingConfig.fhirResourceType.length + 1)
				: el.path,
		),
	);

	// Validação 1: Paths mapeados pelo usuário devem existir na SD
	for (const fieldMapping of mappingConfig.fieldMappings) {
		const userMappedPath = fieldMapping.targetFhirPath;

		if (!isValidFhirPath(userMappedPath, relativeValidPathsFromSD)) {
			throw new InvalidMappingError(
				mappingConfig.name,
				`Path '${userMappedPath}'`,
				targetStructureDefinition.url,
			);
		}

		// Validação 2: Usuário NÃO DEVE mapear campos que têm fixedValue na SD
		// (A menos que seja um DEFAULT_VALUE transformation para o mesmo valor, o que é redundante)
		const fullPathInSD = `${mappingConfig.fhirResourceType}.${userMappedPath.split('[')[0]}`;
		const elementDefForUserPath = allElementsFromSD.find(
			(el) =>
				el.path === fullPathInSD || el.path.startsWith(`${fullPathInSD}:`), // Considera slices e base
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

			// Se o mapeamento não for um DEFAULT_VALUE para o mesmo valor do fixedValue, então é um problema.
			if (
				!(
					fieldMapping.transformationType?.toUpperCase() === 'DEFAULT_VALUE' &&
					userMappedValueViaDefault !== undefined &&
					JSON.stringify(userMappedValueViaDefault) ===
						JSON.stringify(fixedValFromSD)
				)
			) {
				// MUDANÇA: Tornando isso um ERRO, conforme solicitado.
				throw new InvalidMappingError(
					mappingConfig.name,
					`Path '${userMappedPath}'`,
					targetStructureDefinition.url,
				);
			}
		}
	}

	if (mappingConfig.direction === Direction.TO_FHIR) {
		// Validação 3: Para TO_FHIR, garantir que campos obrigatórios (sem fixedValue na SD) sejam mapeados
		const mandatoryElementsInSD = allElementsFromSD.filter(
			(el) => (el.cardinalityMin ?? 0) >= 1 && el.fixedValue === null, // Foco em obrigatórios que NÃO têm valor fixo pelo perfil
		);

		for (const mandatoryElement of mandatoryElementsInSD) {
			const relativeMandatoryPath = mandatoryElement.path.startsWith(
				`${mappingConfig.fhirResourceType}.`,
			)
				? mandatoryElement.path.substring(
						mappingConfig.fhirResourceType.length + 1,
					)
				: mandatoryElement.path;

			if (
				!relativeMandatoryPath ||
				mandatoryElement.path === mappingConfig.fhirResourceType
			)
				continue; // Pula o próprio elemento raiz

			const baseMandatoryPath = relativeMandatoryPath.split('[')[0];
			const isMappedByUser = mappingConfig.fieldMappings.some((fm) =>
				fm.targetFhirPath.startsWith(baseMandatoryPath),
			);

			// Se é obrigatório, não tem fixedValue, e o usuário não mapeou,
			// verificamos se tem um defaultValue na SD. Se também não tiver defaultValue, é um erro.
			if (!isMappedByUser && mandatoryElement.defaultValue === null) {
				throw new InvalidMappingError(
					mappingConfig.name,
					`Mandatory element '${relativeMandatoryPath}'`,
					targetStructureDefinition.url,
				);
			}
		}
	}
	// console.log(`Mapping '${name}' and its field paths validated successfully against SD '${targetStructureDefinition.url}'.`);
	return mappingConfig;
}
