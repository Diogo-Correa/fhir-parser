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
import { MultipartRequestError } from '../services/errors/MultipartRequestError';
import { StructureDefinitionNotProcessedError } from '../services/errors/StructureDefinitionNotProcessedError';
import '../utils/transformation';

export function buildServer(): FastifyInstance {
	const app = Fastify({
		logger: true,
	});

	app.register(sensible);
	app.register(fastifyMultipart);
	// app.register(require('@fastify/redis'), {
	// 	host: 'localhost',
	// 	port: 6379,
	// 	password: 'my_master_password',
	// });

	app.setErrorHandler((error, _, reply) => {
		if (error instanceof ZodError) {
			return reply.status(400).send({
				statusCode: 400,
				success: false,
				message: 'Validation error.',
				issues: error.flatten().fieldErrors,
			});
		}

		if (error.validation) {
			return reply.status(400).send({
				statusCode: 400,
				success: false,
				message: 'Validation error.',
				errors: error.message,
			});
		}

		if (error instanceof MappingConfigurationNotFoundError) {
			return reply
				.status(404)
				.send({ statusCode: 404, success: false, message: error.message });
		}

		if (
			error instanceof InvalidInputDataError ||
			error instanceof InvalidMappingError ||
			error instanceof MultipartRequestError
		) {
			return reply
				.status(400)
				.send({ statusCode: 400, success: false, message: error.message });
		}

		if (error instanceof FhirClientError) {
			return reply
				.status(502)
				.send({ statusCode: 502, success: false, message: error.message });
		}

		if (error instanceof StructureDefinitionNotProcessedError) {
			return reply
				.status(422)
				.send({ statusCode: 422, success: false, message: error.message });
		}

		app.log.error(error);

		// Erro genérico para o cliente
		return reply.status(500).send({
			statusCode: 500,
			success: false,
			message: 'Internal server error.',
		});
	});

	for (const schema of schemas) app.addSchema(schema);
	app.register(appRoutes, { prefix: '/api/v1' });

	return app;
}
