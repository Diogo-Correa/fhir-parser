import type { FastifyInstance } from 'fastify';

export async function appRoutes(app: FastifyInstance): Promise<void> {
	app.get('/health', async (_, reply) => {
		reply.code(200).send({ status: 'ok', timestamp: new Date() });
	});
}
