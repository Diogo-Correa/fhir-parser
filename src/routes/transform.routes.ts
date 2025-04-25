import type { FastifyInstance } from 'fastify';
import { handleTransformRequest } from '../controllers/transform.controller';

export async function transformRoutes(app: FastifyInstance) {
	app.post('/', {}, handleTransformRequest);
}
