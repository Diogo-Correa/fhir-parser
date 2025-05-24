import { buildJsonSchemas } from 'fastify-zod';
import { z } from 'zod';

export const transformBodySchema = z.object({
	mappingConfigName: z
		.string()
		.min(1, { message: 'Voce deve informar o nome do mapeamento.' }),

	sendToFhirServer: z
		.union([z.boolean(), z.string()])
		.transform((val) =>
			typeof val === 'string' ? val.toLowerCase() === 'true' : val,
		)
		.optional()
		.default(false),

	fhirServerUrlOverride: z
		.string()
		.url({ message: 'URL incorreta para fhirServerUrlOverride.' })
		.optional()
		.nullable()
		.or(z.literal('')), // Permite nulo ou string vazia

	fhirQueryPath: z.string().optional().nullable(), // Para FROM_FHIR
	data: z
		.array(
			z.record(z.unknown(), {
				description: 'Objeto JSON de entrada para ser transformado.',
			}),
		)
		.min(1, { message: 'A lista de dados não pode estar vazia.' }),
});

export type TransformBodyParams = z.infer<typeof transformBodySchema>;

export const { schemas: transformSchemas, $ref } = buildJsonSchemas(
	{
		transformBodySchema,
	},
	{ $id: 'transformSchemas' },
);
