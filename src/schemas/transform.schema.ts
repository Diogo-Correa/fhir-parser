import { z } from 'zod';

export const transformRequestBodySchema = z.object({
	mappingConfigName: z
		.string()
		.min(1, { message: 'Mapping config name is required' }),
	data: z.any(),
	sendToFhirServer: z.boolean().optional().default(false),
	fhirServerUrlOverride: z.string().url().optional(),
});

export type TransformRequestBody = z.infer<typeof transformRequestBodySchema>;
