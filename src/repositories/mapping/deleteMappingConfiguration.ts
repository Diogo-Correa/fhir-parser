import { db } from '../../lib/prisma';

export async function deleteMappingConfigurationByIdentifier(
	identifier: string,
) {
	const isCUID = /^[c][^\\s-]{24}$/.test(identifier);
	const whereClause = isCUID ? { id: identifier } : { name: identifier };

	const configToDelete = await db.mappingConfiguration.findUnique({
		where: whereClause,
	});

	if (!configToDelete) return null;

	await db.mappingConfiguration.delete({
		where: { id: configToDelete.id },
	});

	return configToDelete;
}
