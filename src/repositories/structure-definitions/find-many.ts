import { db } from '../../lib/prisma';

export async function findManyStructureDefinitions() {
	const structureDefinitions = await db.fhirStructureDefinition.findMany({});
	return structureDefinitions;
}
