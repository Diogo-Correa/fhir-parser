import fastifyMultipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { appRoutes } from '../routes';
import { schemas } from '../schemas';
import '../utils/transformation';

export function buildServer(): FastifyInstance {
	const app = Fastify({
		logger: true,
	});

	app.register(sensible);
	app.register(fastifyMultipart);
	app.addContentTypeParser('text/csv', (request, payload, done) => {
		done(null);
	});
	for (const schema of schemas) app.addSchema(schema);
	app.register(appRoutes, { prefix: '/api/v1' });

	return app;
}
