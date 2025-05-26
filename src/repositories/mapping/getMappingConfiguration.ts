import { db } from '../../lib/prisma';

export async function getMappingConfigurationByIdentifier(identifier: string) {
	const isCUID = /^[c][^\\s-]{24}$/.test(identifier);

	let whereClause: { id: string } | { name: string } = { name: identifier };

	if (isCUID) whereClause = { id: identifier };

	const mappingConfig = await db.mappingConfiguration.findUnique({
		where: whereClause,
		include: {
			fieldMappings: true,
		},
	});

	return mappingConfig;
}
