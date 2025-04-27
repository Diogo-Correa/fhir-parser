import type { FieldMapping, MappingConfiguration } from '@prisma/client';

export type MappingConfigWithFields = MappingConfiguration & {
	fieldMappings: FieldMapping[];
};
