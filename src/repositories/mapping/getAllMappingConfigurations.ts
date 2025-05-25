import { db } from '../../lib/prisma';

export async function getAllMappingConfigurations(includeFields = false) {
	return db.mappingConfiguration.findMany({
		include: {
			fieldMappings: includeFields,
			_count: {
				select: { fieldMappings: true },
			},
		},
		orderBy: {
			name: 'asc',
		},
	});
}
