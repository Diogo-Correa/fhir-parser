import type { FieldMapping, MappingConfiguration } from '@prisma/client';
import { db } from '../lib/prisma';
import { getMappingConfigurationByName } from '../repositories/mapping/getMappingConfiguration';
import { InvalidMappingError } from './errors/InvalidMappingError';
import { MappingConfigurationNotFoundError } from './errors/MappingConfigurationNotFoundError';
import { StructureDefinitionNotProcessedError } from './errors/StructureDefinitionNotProcessedError';

type MappingConfigWithFields = MappingConfiguration & {
	fieldMappings: FieldMapping[];
};

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
	let targetStructureDefinition;
	if (mappingConfig.structureDefinitionUrl) {
		targetStructureDefinition = await db.fhirStructureDefinition.findUnique({
			where: { url: mappingConfig.structureDefinitionUrl },
			include: { elements: { select: { path: true } } }, // Apenas os paths
		});
	} else {
		// Fallback: Busca pelo tipo base
		targetStructureDefinition = await db.fhirStructureDefinition.findFirst({
			where: { type: mappingConfig.fhirResourceType },
			include: { elements: { select: { path: true } } },
			orderBy: {
				// Desambiguação simples se houver múltiplas versões processadas
				processedAt: 'desc', // Pega a mais recente processada
			},
		});
	}

	if (
		!targetStructureDefinition ||
		targetStructureDefinition.elements.length === 0
	) {
		// Se a URL foi especificada mas não encontrada/processada, lança erro específico
		if (mappingConfig.structureDefinitionUrl) {
			throw new StructureDefinitionNotProcessedError(
				mappingConfig.structureDefinitionUrl,
			);
		}
		// Se usou o tipo base e não encontrou/processou, lança erro mais genérico
		throw new StructureDefinitionNotProcessedError(
			`Base StructureDefinition for type '${mappingConfig.fhirResourceType}'`,
		);
	}

	// 4. Cria um Set com os caminhos válidos
	const validFhirPaths = new Set(
		targetStructureDefinition.elements.map((el) => el.path),
	);
	// console.debug(`Validating mapping '${name}' against ${validFhirPaths.size} paths from SD '${targetStructureDefinition.url}'`);

	// 5. Valida cada FieldMapping
	for (const fieldMapping of mappingConfig.fieldMappings) {
		// Valida sempre o targetFhirPath
		const pathToValidate = fieldMapping.targetFhirPath;

		if (!isValidFhirPath(pathToValidate, validFhirPaths)) {
			console.error(
				`Mapping validation failed for configuration '${mappingConfig.name}': Path '${pathToValidate}' is invalid according to SD '${targetStructureDefinition.url}'.`,
			);
			throw new InvalidMappingError(
				mappingConfig.name,
				pathToValidate,
				targetStructureDefinition.url,
			);
		}
	}

	// console.debug(`Mapping '${name}' validated successfully.`);
	// 6. Retorna a configuração validada
	return mappingConfig;
}
