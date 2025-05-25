import { db } from '../../lib/prisma';
import type { FhirStructureDefinitionWithPaths } from '../../types/StructureDefinition';

export async function findUniqueStructureDefinitionByUrlOrType(
	url?: string | null,
	type?: string | null,
): Promise<FhirStructureDefinitionWithPaths | null> {
	return await db.fhirStructureDefinition.findFirst({
		where: {
			OR: [...(url ? [{ url }] : []), ...(type ? [{ type }] : [])],
		},
		include: { elements: true },
		orderBy: {
			processedAt: 'desc',
		},
	});
}

export async function findMandatoryStructureDefinitionByUrlOrType(
	url?: string | null,
	type?: string | null,
): Promise<FhirStructureDefinitionWithPaths | null> {
	const sd = await db.fhirStructureDefinition.findFirst({
		where: {
			OR: [...(url ? [{ url }] : []), ...(type ? [{ type }] : [])],
		},
		include: {
			elements: {
				where: {
					cardinalityMin: { gte: 1 },
					OR: [{ fixedValue: { not: null } }, { defaultValue: { not: null } }],
				},
			},
		},
	});

	return sd;
}

export async function findFirstMandatoryStructureDefinitionByUrlOrType(
	url?: string | null,
	type?: string | null,
): Promise<FhirStructureDefinitionWithPaths | null> {
	const sd = await db.fhirStructureDefinition.findFirst({
		where: {
			OR: [...(url ? [{ url }] : []), ...(type ? [{ type }] : [])],
		},
		include: {
			elements: {
				where: { cardinalityMin: { gte: 1 } },
			},
		},
	});

	return sd;
}

export async function findElementsWithFixedOrDefaultValue(
	url?: string | null,
	type?: string | null,
): Promise<FhirStructureDefinitionWithPaths | null> {
	return db.fhirStructureDefinition.findFirst({
		where: { OR: [...(url ? [{ url }] : []), ...(type ? [{ type }] : [])] },
		include: {
			elements: {
				where: {
					OR: [{ fixedValue: { not: null } }, { defaultValue: { not: null } }],
				},
			},
		},
		orderBy: { processedAt: 'desc' },
	});
}
