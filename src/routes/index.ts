import type { FastifyInstance } from 'fastify';
import { transformRoutes } from './transform.routes';

export async function appRoutes(app: FastifyInstance): Promise<void> {
	app.register(transformRoutes, { prefix: '/transform' });

	app.get('/health', async (_, reply) => {
		reply.code(200).send({ status: 'ok', timestamp: new Date() });
	});
}
