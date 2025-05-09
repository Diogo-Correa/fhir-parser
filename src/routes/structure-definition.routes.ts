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
				summary: 'Get StructureDefinitions',
				description:
					'Retrieves all StructureDefinitions stored in the database.',
			},
		},
		handleGetStructureDefinition,
	);
	app.post(
		'/search',
		{
			schema: {
				tags: ['StructureDefinition'],
				summary: 'Get a StructureDefinition by URL or Type',
				description:
					'Retrieves a StructureDefinition by its URL or Type from the database.',
				body: $ref('getUniqueStructureDefinitionSchema'),
			},
		},
		handleGetUniqueStructureDefinition,
	);
	app.post(
		'/',
		{
			schema: {
				tags: ['StructureDefinition'],
				summary: 'Process a StructureDefinition',
				description:
					'Processes a StructureDefinition from a FHIR server and stores it in the database.',
				body: $ref('processStructureDefinitionSchema'),
			},
		},
		handleProcessStructureDefinition,
	);
}
