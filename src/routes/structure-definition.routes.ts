import type { FastifyInstance } from 'fastify';
import {
	handleGetStructureDefinition,
	handleGetUniqueStructureDefinition,
	handleProcessStructureDefinition,
} from '../controllers/structure-definition.controller';
import { $ref } from '../schemas/structure-definition.schema';

export async function structureDefinitionRoutes(app: FastifyInstance) {
	app.get(
		'/',
		{
			schema: {
				tags: ['StructureDefinition'],
				summary: 'Get all stored StructureDefinitions',
				description:
					'Retrieves a list of all StructureDefinitions that have been processed and stored in the database. Does not include element definitions for brevity.',
				response: {
					200: $ref('getAllStructureDefinitionsResponseSchema'),
					500: {
						type: 'object',
						properties: {
							message: { type: 'string' },
							success: { type: 'boolean', example: false },
						},
					},
				},
			},
		},
		handleGetStructureDefinition,
	);
	app.post(
		'/search',
		{
			schema: {
				tags: ['StructureDefinition'],
				summary: 'Get a specific StructureDefinition by URL or Type',
				description:
					'Retrieves a single StructureDefinition (including its element definitions) by its canonical URL or its base FHIR type from the database.',
				body: $ref('getUniqueStructureDefinitionSchema'),
				response: {
					200: $ref('getSingleStructureDefinitionResponseSchema'),
					404: {
						type: 'object',
						properties: {
							message: { type: 'string' },
							success: { type: 'boolean', example: false },
						},
					},
					500: {
						type: 'object',
						properties: {
							message: { type: 'string' },
							success: { type: 'boolean', example: false },
						},
					},
				},
			},
		},
		handleGetUniqueStructureDefinition,
	);
	app.post(
		'/',
		{
			schema: {
				tags: ['StructureDefinition'],
				summary: 'Process and store a StructureDefinition',
				description:
					'Fetches a StructureDefinition from a FHIR server using its identifier (ID or canonical URL), processes it, and stores it along with its element definitions in the database.',
				body: $ref('processStructureDefinitionSchema'),
				response: {
					200: $ref('processStructureDefinitionResponseSchema'),
					201: $ref('processStructureDefinitionResponseSchema'),
					400: {
						type: 'object',
						properties: {
							message: { type: 'string' },
							success: { type: 'boolean', example: false },
						},
					},
					500: {
						type: 'object',
						properties: {
							message: { type: 'string' },
							success: { type: 'boolean', example: false },
						},
					},
					502: {
						type: 'object',
						properties: {
							message: { type: 'string' },
							success: { type: 'boolean', example: false },
						},
					},
				},
			},
		},
		handleProcessStructureDefinition,
	);
}
