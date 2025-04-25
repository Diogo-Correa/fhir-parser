import type { FastifyInstance } from 'fastify';
import { handleProcessStructureDefinition } from '../controllers/structure-definition.controller';

export async function structureDefinitionRoutes(app: FastifyInstance) {
	app.post('/', {}, handleProcessStructureDefinition);
}
