import type { Prisma } from '@prisma/client';
import { db } from '../../lib/prisma';

export async function fhirStructureDefinitionTransaction(
	url: string,
	data: Prisma.FhirStructureDefinitionCreateInput,
	elementsData: Omit<
		Prisma.FhirElementDefinitionCreateManyInput,
		'structureDefinitionId'
	>[],
) {
	return await db.$transaction(async (tx) => {
		const upsertedSd = await tx.fhirStructureDefinition.upsert({
			where: { url },
			update: { ...data, processedAt: new Date() }, // Atualiza data de processamento
			create: data,
		});
		await tx.fhirElementDefinition.deleteMany({
			where: { structureDefinitionId: upsertedSd.id },
		});
		if (elementsData.length > 0) {
			const elementsToCreate = elementsData.map((el) => ({
				...el,
				structureDefinitionId: upsertedSd.id,
			}));
			await tx.fhirElementDefinition.createMany({
				data: elementsToCreate,
				skipDuplicates: true, // Ignora duplicatas silenciosamente se @@unique falhar por algum motivo
			});
		}
		return upsertedSd;
	});
}
