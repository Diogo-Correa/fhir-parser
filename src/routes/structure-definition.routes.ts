import type { FastifyInstance } from 'fastify';
import {
	handleGetStructureDefinition,
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
