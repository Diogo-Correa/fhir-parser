import { z } from 'zod';

export const processStructureDefinitionSchema = z.object({
	identifier: z
		.string({
			required_error: 'StructureDefinition identifier (ID or URL) is required',
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
