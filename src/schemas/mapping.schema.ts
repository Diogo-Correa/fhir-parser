import {
	Direction,
	SourceType,
	TransformationType,
	ValidationType,
} from '@prisma/client';
import { buildJsonSchemas } from 'fastify-zod';
import { z } from 'zod';

const cuidRegex = /^[c][^\\s-]{24}$/;

const directionEnum = z.nativeEnum(Direction);
const sourceTypeEnum = z.nativeEnum(SourceType);
const validationTypeEnum = z.nativeEnum(ValidationType);
const transformationTypeEnum = z.nativeEnum(TransformationType);

export const fieldMappingSchema = z.object({
	id: z
		.string()
		.regex(cuidRegex, 'Invalid CUID format for FieldMapping ID')
		.optional(),
	sourcePath: z.string().min(1, 'Source path cannot be empty.'),
	targetFhirPath: z.string().min(1, 'Target FHIR path cannot be empty.'),
	validationType: validationTypeEnum.optional().nullable(),
	validationDetails: z.record(z.unknown()).optional().nullable(),
	transformationType: transformationTypeEnum.optional().nullable(),
	transformationDetails: z.record(z.unknown()).optional().nullable(),
});
export type FieldMappingInput = z.infer<typeof fieldMappingSchema>;

const mappingConfigurationBaseSchema = z.object({
	name: z.string().min(3, 'Mapping name must be at least 3 characters long.'),
	description: z.string().optional().nullable(),
	sourceType: sourceTypeEnum,
	direction: directionEnum,
	fhirResourceType: z.string().min(1, 'FHIR Resource Type cannot be empty.'),
	structureDefinitionUrl: z
		.string()
		.url('Invalid URL for StructureDefinition.')
		.optional()
		.nullable(),
});

export const createMappingConfigurationSchema =
	mappingConfigurationBaseSchema.extend({
		fieldMappings: z
			.array(fieldMappingSchema.omit({ id: true }))
			.min(1, 'At least one field mapping is required.'),
	});
export type CreateMappingConfigurationInput = z.infer<
	typeof createMappingConfigurationSchema
>;

export const updateMappingConfigurationSchema = mappingConfigurationBaseSchema
	.partial()
	.extend({
		name: z
			.string()
			.min(3, 'Mapping name must be at least 3 characters long.')
			.optional(),
		fieldMappings: z.array(fieldMappingSchema.omit({ id: true })).optional(),
	});
export type UpdateMappingConfigurationInput = z.infer<
	typeof updateMappingConfigurationSchema
>;

export const mappingIdentifierParamSchema = z.object({
	identifier: z.string().min(1, 'Identifier (name or CUID) is required.'),
});
export type MappingIdentifierParams = z.infer<
	typeof mappingIdentifierParamSchema
>;

const fieldMappingResponseSchema = fieldMappingSchema.extend({
	id: z.string().regex(cuidRegex, 'Invalid CUID format'),
	mappingConfigurationId: z.string().regex(cuidRegex, 'Invalid CUID format'),
});

const mappingConfigurationResponseSchema =
	mappingConfigurationBaseSchema.extend({
		id: z.string().regex(cuidRegex, 'Invalid CUID format'),
		name: z.string(),
		fieldMappings: z.array(fieldMappingResponseSchema),
		createdAt: z.string().datetime(),
		updatedAt: z.string().datetime(),
	});

const mappingConfigurationSummaryResponseSchema =
	mappingConfigurationBaseSchema.extend({
		id: z.string().regex(cuidRegex, 'Invalid CUID format'),
		name: z.string(),
		fieldMappingsCount: z.number().int().nonnegative(),
		createdAt: z.string().datetime(),
		updatedAt: z.string().datetime(),
	});

export const { schemas: mappingSchemas, $ref } = buildJsonSchemas(
	{
		createMappingConfigurationSchema,
		updateMappingConfigurationSchema,
		mappingIdentifierParamSchema,
		fieldMappingSchema,
		mappingConfigurationResponseSchema,
		mappingConfigurationSummaryResponseSchema,
	},
	{ $id: 'mappingSchemas' },
);
