import type { FastifyInstance } from 'fastify';
import {
	handleTransformByFile,
	handleTransformRequest,
} from '../controllers/transform.controller';
import { $ref } from '../schemas/transform.schema';

export async function transformRoutes(app: FastifyInstance) {
	app.post(
		'/',
		{
			schema: {
				body: $ref('transformBodySchema'),
			},
		},
		handleTransformRequest,
	);
	app.post(
		'/file',
		{
			schema: {
				consumes: ['multipart/form-data'],
			},
		},
		handleTransformByFile,
	);
}
