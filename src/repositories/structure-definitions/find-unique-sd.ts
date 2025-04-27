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
		include: { elements: { select: { path: true } } },
		orderBy: {
			processedAt: 'desc',
		},
	});
}
