import { db } from '../../lib/prisma';

export async function getMappingConfigurationByName(name: string) {
	const mappingConfig = await db.mappingConfiguration.findUnique({
		where: { name },
		include: {
			fieldMappings: true,
		},
	});

	return mappingConfig;
}
