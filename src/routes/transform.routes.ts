import type { FastifyInstance } from 'fastify';
import { handleTransformRequest } from '../controllers/transform.controller';
import { transformRequestBodySchema } from '../schemas/transform.schema';

export async function transformRoutes(app: FastifyInstance) {
	app.post(
		'/',
		{
			schema: {
				body: transformRequestBodySchema,
			},
		},
		handleTransformRequest,
	);
}
