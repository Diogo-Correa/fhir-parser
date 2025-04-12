import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { appRoutes } from '../routes';
import { schemas } from '../schemas';

export function buildServer(): FastifyInstance {
	const app = Fastify({
		logger: true,
	});

	app.register(sensible);
	for (const schema of schemas) app.addSchema(schema);
	app.register(appRoutes, { prefix: '/api' });

	return app;
}
