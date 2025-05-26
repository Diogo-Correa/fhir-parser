import type { Prisma } from '@prisma/client';
import { db } from '../../lib/prisma';

export async function createMappingConfigurationWithFields(
	data: Prisma.MappingConfigurationCreateInput,
	fieldMappingsData: Omit<
		Prisma.FieldMappingCreateManyInput,
		'mappingConfigurationId'
	>[],
) {
	return db.mappingConfiguration.create({
		data: {
			...data,
			fieldMappings: {
				createMany: {
					data: fieldMappingsData,
				},
			},
		},
		include: {
			fieldMappings: true,
		},
	});
}
