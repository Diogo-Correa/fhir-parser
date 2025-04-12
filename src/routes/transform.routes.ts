import type { FastifyInstance } from 'fastify';
import { handleTransformRequest } from '../controllers/transform.controller';
import { $ref } from '../schemas/transform.schema';

export async function transformRoutes(app: FastifyInstance) {
	app.post(
		'/',
		{
			schema: {
				body: $ref('transformRequestBodySchema'),
			},
		},
		handleTransformRequest,
	);
}
