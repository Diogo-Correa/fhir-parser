import { buildJsonSchemas } from 'fastify-zod';
import { z } from 'zod';

export const transformBodySchema = z.object({
	mappingConfigName: z
		.string({ required_error: 'mappingConfigName is required' })
		.min(1, 'mappingConfigName cannot be empty'),

	// Para booleanos de multipart, eles vêm como string 'true' ou 'false'
	sendToFhirServer: z
		.union([z.boolean(), z.string()])
		.transform((val) =>
			typeof val === 'string' ? val.toLowerCase() === 'true' : val,
		)
		.optional()
		.default(false),

	fhirServerUrlOverride: z
		.string()
		.url('Invalid URL for fhirServerUrlOverride')
		.optional()
		.nullable()
		.or(z.literal('')), // Permite nulo ou string vazia

	fhirQueryPath: z.string().optional().nullable(), // Para FROM_FHIR

	// 'data' é para JSON inline (TO_FHIR). O arquivo (para multipart) é tratado separadamente pelo controller.
	data: z.any().optional().nullable(),
});

export type TransformBodyParams = z.infer<typeof transformBodySchema>;

export const { schemas: transformSchemas, $ref } = buildJsonSchemas(
	{
		transformBodySchema,
	},
	{ $id: 'transformSchemas' },
);
