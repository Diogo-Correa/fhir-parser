import { db } from '../../lib/prisma';

export async function deleteManyElementStructureDefinitions(
	id: string,
): Promise<void> {
	await db.fhirElementDefinition.deleteMany({
		where: { structureDefinitionId: id },
	});
}
