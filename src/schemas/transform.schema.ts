import { buildJsonSchemas } from 'fastify-zod';
import { Readable } from 'node:stream';
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
		.or(z.literal('')),

	fhirQueryPath: z.string().optional().nullable(),
	data: z
		.array(
			z.record(z.unknown(), {
				description: 'Objeto JSON de entrada para ser transformado.',
			}),
		)
		.min(1, { message: 'A lista de dados não pode estar vazia.' })
		.optional(),
});

export const transformFileSchema = z.object({
	mappingConfigName: z
		.string({ message: 'Voce deve informar o nome do mapeamento.' })
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
		.or(z.literal('')),

	fhirQueryPath: z
		.string({ message: 'Informe o path de busca no servidor FHIR.' })
		.optional()
		.nullable(),
	file: z.instanceof(Readable, {
		message: 'O arquivo deve ser um stream legível.',
	}),
});

const fieldProcessingErrorDetailSchema = z.object({
	fieldSourcePath: z.string().optional().nullable(),
	fieldTargetPath: z.string(),
	inputValue: z.any().describe('The input value that caused the error'),
	errorType: z.string(),
	message: z.string(),
	details: z
		.any()
		.optional()
		.describe(
			'Additional details about the error or validation/transformation rule',
		),
});

const streamItemErrorSchema = z.object({
	type: z
		.literal('StreamItemError')
		.describe('Discriminator for StreamItemError'),
	errors: z
		.array(fieldProcessingErrorDetailSchema)
		.describe('Specific errors related to processing the item'),
	originalItem: z
		.any()
		.describe('The original item from the stream that caused the error'),
	_isTransformError: z.literal(true).optional(),
});

const chunkParseErrorSchema = z.object({
	type: z
		.literal('ChunkParseError')
		.describe('Discriminator for ChunkParseError'),
	message: z.string(),
	chunk: z.string().describe('The problematic chunk prefix'),
});

const pipelineErrorSchema = z.object({
	type: z.literal('PipelineError').describe('Discriminator for PipelineError'),
	message: z.string(),
	stack: z.string().optional(),
});

const streamProcessingErrorSchema = z.object({
	type: z.literal('StreamProcessingError'),
	message: z.string(),
	originalItem: z.any().optional(),
});

const individualErrorSchema = z.union([
	streamItemErrorSchema,
	chunkParseErrorSchema,
	pipelineErrorSchema,
	streamProcessingErrorSchema,
]);

export const transformResponseSchema = z.object({
	success: z.boolean().optional(),
	message: z.string(),
	data: z
		.array(z.record(z.unknown()))
		.optional()
		.describe(
			'Array of transformed data items. Present on success or if some items succeeded before an error.',
		),
	errors: z
		.array(individualErrorSchema)
		.optional()
		.describe('Array of errors encountered during processing.'),
});

export type TransformBodyParams = z.infer<typeof transformBodySchema>;
export type TransformFileParams = z.infer<typeof transformFileSchema>;

export const { schemas: transformSchemas, $ref } = buildJsonSchemas(
	{
		transformBodySchema,
		transformFileSchema,
		fieldProcessingErrorDetailSchema,
		streamItemErrorSchema,
		chunkParseErrorSchema,
		pipelineErrorSchema,
		streamProcessingErrorSchema,
		individualErrorSchema,
		transformResponseSchema,
	},
	{ $id: 'transformSchemas' },
);
