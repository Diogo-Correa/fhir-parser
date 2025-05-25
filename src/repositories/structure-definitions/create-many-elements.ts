import type { Prisma } from '@prisma/client';
import { db } from '../../lib/prisma';

export async function createManyElementStructureDefinitions(
	elements: Prisma.FhirElementDefinitionCreateManyInput[],
): Promise<Prisma.FhirElementDefinitionCreateManyInput[]> {
	return await db.fhirElementDefinition.createManyAndReturn({
		data: elements,
	});
}
