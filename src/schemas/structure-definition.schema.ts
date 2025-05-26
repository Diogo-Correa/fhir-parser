import { buildJsonSchemas } from 'fastify-zod';
import { z } from 'zod';

const idRegex =
	/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$|^[c][^\\s-]{24}$/;

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

// Schemas de Resposta
const fhirElementDefinitionResponseSchema = z.object({
	id: z.string().regex(idRegex),
	structureDefinitionId: z.string().regex(idRegex),
	path: z.string(),
	sliceName: z.string().optional().nullable(),
	shortDescription: z.string().optional().nullable(),
	definition: z.string().optional().nullable(),
	dataTypes: z.array(z.string()).optional(),
	cardinalityMin: z.number().int().optional().nullable(),
	cardinalityMax: z.string().optional().nullable(),
	fixedValue: z.string().optional().nullable(),
	fixedValueType: z.string().optional().nullable(),
	defaultValue: z.string().optional().nullable(),
	defaultValueType: z.string().optional().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

const structureDefinitionItemSchema = z.object({
	id: z.string().regex(idRegex),
	url: z.string().url(),
	version: z.string().optional().nullable(),
	name: z.string(),
	type: z.string(),
	fhirVersion: z.string().optional().nullable(),
	description: z.string().optional().nullable(),
	processedAt: z.string().datetime().optional().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

const structureDefinitionDetailResponseSchema =
	structureDefinitionItemSchema.extend({
		elements: z.array(fhirElementDefinitionResponseSchema).optional(),
	});

const getAllStructureDefinitionsResponseSchema = z.object({
	message: z.string(),
	success: z.boolean(),
	data: z.array(structureDefinitionItemSchema),
});

const getSingleStructureDefinitionResponseSchema = z.object({
	message: z.string(),
	success: z.boolean(),
	data: z.array(structureDefinitionDetailResponseSchema).optional().nullable(),
});

const processStructureDefinitionResponseSchema = z.object({
	success: z.boolean(),
	message: z.string(),
	structureDefinitionId: z.string().regex(idRegex).optional(),
	elementCount: z.number().int().optional(),
	structureDefinitionUrl: z.string().url().optional(),
});

export const { schemas: structureDefinitionSchemas, $ref } = buildJsonSchemas(
	{
		processStructureDefinitionSchema,
		getUniqueStructureDefinitionSchema,
		structureDefinitionItemSchema,
		structureDefinitionDetailResponseSchema,
		getAllStructureDefinitionsResponseSchema,
		getSingleStructureDefinitionResponseSchema,
		processStructureDefinitionResponseSchema,
	},
	{ $id: 'structureDefinitionSchemas' },
);
