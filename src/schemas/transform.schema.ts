import { buildJsonSchemas } from 'fastify-zod';
import { z } from 'zod';

export const transformRequestBodySchema = z.object({
	mappingConfigName: z
		.string()
		.min(1, { message: 'Mapping config name is required' }),
	data: z.any(),
	sendToFhirServer: z.boolean().optional().default(false),
	fhirServerUrlOverride: z.string().url().optional(),
});

export const transformApiSchema = z.object({
	mappingConfigName: z
		.string({ required_error: 'mappingConfigName is required' })
		.min(1),
	sendToFhirServer: z.boolean().optional().default(false),
	fhirServerUrlOverride: z.string().url().optional(),
	fhirQueryPath: z.string().optional(), // Obrigatório para FROM_FHIR (validado no serviço)
});

export type TransformRequestBody = z.infer<typeof transformRequestBodySchema>;
export type TransformApiParams = z.infer<typeof transformApiSchema>;

export const { schemas: transformSchemas, $ref } = buildJsonSchemas(
	{
		transformRequestBodySchema,
	},
	{ $id: 'transformSchemas' },
);
