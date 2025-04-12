import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { appRoutes } from '../routes';

export function buildServer(): FastifyInstance {
	const app = Fastify({
		logger: true,
	});

	app.register(sensible);
	app.register(appRoutes, { prefix: '/api' });

	return app;
}
