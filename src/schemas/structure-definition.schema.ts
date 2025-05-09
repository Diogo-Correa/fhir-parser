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

export type ProcessStructureDefinitionBody = z.infer<
	typeof processStructureDefinitionSchema
>;

export const { schemas: structureDefinitionSchemas, $ref } = buildJsonSchemas(
	{
		processStructureDefinitionSchema,
	},
	{ $id: 'structureDefinitionSchemas' },
);
