import { buildJsonSchemas } from 'fastify-zod';
import { z } from 'zod';

export const processStructureDefinitionSchema = z.object({
	identifier: z
		.string({
			message: 'StructureDefinition identifier (ID or URL) is required',
		})
		.min(1),
	fhirServerUrl: z
		.string()
		.url('Invalid URL format for fhirServerUrl')
		.optional(),
});

export const getUniqueStructureDefinitionSchema = z
	.object({
		url: z.string().url().optional(),
		type: z.string().optional(),
	})
	.refine((data) => data.url || data.type, {
		message: 'Either url or type must be provided',
	});

export type ProcessStructureDefinitionBody = z.infer<
	typeof processStructureDefinitionSchema
>;
export type GetUniqueStructureDefinitionParams = z.infer<
	typeof getUniqueStructureDefinitionSchema
>;

export const { schemas: structureDefinitionSchemas, $ref } = buildJsonSchemas(
	{
		processStructureDefinitionSchema,
		getUniqueStructureDefinitionSchema,
	},
	{ $id: 'structureDefinitionSchemas' },
);
