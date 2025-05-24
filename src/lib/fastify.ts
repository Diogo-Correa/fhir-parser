import fastifyMultipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { appRoutes } from '../routes';
import { schemas } from '../schemas';
import { FhirClientError } from '../services/errors/FhirClientError';
import { InvalidInputDataError } from '../services/errors/InvalidInputDataError';
import { InvalidMappingError } from '../services/errors/InvalidMappingError';
import { MappingConfigurationNotFoundError } from '../services/errors/MappingConfigurationNotFoundError';
import { StructureDefinitionNotProcessedError } from '../services/errors/StructureDefinitionNotProcessedError';
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

	app.setErrorHandler((error, request, reply) => {
		if (error instanceof ZodError) {
			return reply
				.status(400)
				.send({ message: 'Validation error.', issues: error.format() });
		}

		if (error instanceof MappingConfigurationNotFoundError) {
			return reply.status(404).send({ message: error.message });
		}

		if (
			error instanceof InvalidInputDataError ||
			error instanceof InvalidMappingError
		) {
			return reply.status(400).send({ message: error.message });
		}

		if (error instanceof FhirClientError) {
			// Pode ser um 502 Bad Gateway se for um erro ao contatar um serviço externo
			return reply.status(502).send({ message: error.message });
		}

		if (error instanceof StructureDefinitionNotProcessedError) {
			return reply.status(422).send({ message: error.message }); // 422 Unprocessable Entity
		}

		app.log.error(error);

		// Erro genérico para o cliente
		return reply.status(500).send({ message: 'Internal server error.' });
	});

	for (const schema of schemas) app.addSchema(schema);
	app.register(appRoutes, { prefix: '/api/v1' });

	return app;
}
