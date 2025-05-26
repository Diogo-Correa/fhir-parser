import { buildJsonSchemas } from 'fastify-zod';
import { z } from 'zod';

const stringListResponseSchema = z.object({
	types: z.array(z.string()),
});

const fieldMappingDryRunSchema = z.object({
	sourcePath: z.string().min(1, 'Source path cannot be empty.'),
	targetFhirPath: z.string().min(1, 'Target FHIR path cannot be empty.'),
	validationType: z.string().optional().nullable(),
	validationDetails: z.record(z.unknown()).optional().nullable(),
	transformationType: z.string().optional().nullable(),
	transformationDetails: z.record(z.unknown()).optional().nullable(),
});

export const validateMappingConfigurationDryRunSchema = z.object({
	name: z.string().min(3, 'Mapping name must be at least 3 characters long.'),
	description: z.string().optional().nullable(),
	sourceType: z.string(),
	direction: z.string(),
	fhirResourceType: z.string().min(1, 'FHIR Resource Type cannot be empty.'),
	structureDefinitionUrl: z
		.string()
		.url('Invalid URL for StructureDefinition.')
		.optional()
		.nullable(),
	fieldMappings: z
		.array(fieldMappingDryRunSchema)
		.min(1, 'At least one field mapping is required.'),
});
export type ValidateMappingConfigurationDryRunInput = z.infer<
	typeof validateMappingConfigurationDryRunSchema
>;

const validationResultResponseSchema = z.object({
	success: z.boolean(),
	message: z.string(),
	issues: z
		.array(
			z.object({
				path: z.string().optional(),
				message: z.string(),
			}),
		)
		.optional(),
});

export const { schemas: mappingUtilitySchemas, $ref } = buildJsonSchemas(
	{
		stringListResponseSchema,
		validateMappingConfigurationDryRunSchema,
		validationResultResponseSchema,
	},
	{ $id: 'mappingUtilitySchemas' },
);
