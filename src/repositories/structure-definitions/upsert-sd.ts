import type { Prisma } from '@prisma/client';
import { db } from '../../lib/prisma';

export async function upsertStructureDefinition(
	url: string,
	data: Prisma.FhirStructureDefinitionCreateInput,
): Promise<Prisma.FhirStructureDefinitionCreateInput> {
	const upsertedSd = await db.fhirStructureDefinition.upsert({
		where: { url },
		update: { ...data, processedAt: new Date() }, // Atualiza data de processamento
		create: data,
	});

	return upsertedSd;
}
