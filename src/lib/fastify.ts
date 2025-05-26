import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
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
import { swagger } from './swagger';

export function buildServer(): FastifyInstance {
	const app = Fastify({
		logger: true,
		bodyLimit: 30 * 1024 * 1024,
	});

	app.register(fastifyRateLimit, {
		max: 100,
		timeWindow: '1 minute',
		ban: 2,
		addHeaders: {
			'x-ratelimit-limit': true,
			'x-ratelimit-remaining': true,
			'x-ratelimit-reset': true,
		},
		addHeadersOnExceeding: {
			'x-ratelimit-limit': true,
			'x-ratelimit-remaining': true,
		},
	});

	app.register(sensible);
	app.register(fastifyMultipart);

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

		if (
			error.statusCode === 429 ||
			(error.statusCode === 403 &&
				error.message?.includes('Rate limit exceeded'))
		) {
			const responsePayload: {
				statusCode: number;
				success: boolean;
				error: string;
				message: string;
				retryAfter?: number;
			} = {
				statusCode: error.statusCode,
				success: false,
				error: error.statusCode === 429 ? 'Too Many Requests' : 'Forbidden',
				message:
					error.message ||
					(error.statusCode === 429
						? 'You have exceeded the request limit.'
						: 'Access denied due to rate limiting.'),
			};

			if (error.headers && typeof error.headers === 'object') {
				reply.headers(
					error.headers as Record<string, string | number | string[]>,
				);
			}

			if (typeof error.retryAfter === 'number') {
				reply.header('Retry-After', error.retryAfter);
				responsePayload.retryAfter = error.retryAfter;
			} else {
				reply.header('Retry-After', 60);
			}

			return reply.status(error.statusCode).send(responsePayload);
		}

		if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
			app.log.warn(`Request body too large: ${error.message}`);
			return reply.status(413).send({
				statusCode: 413,
				success: false,
				message: 'Payload too large. Please send a smaller request body.',
				code: error.code,
			});
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
	app.register(require('@fastify/swagger'), swagger);
	app.register(appRoutes, { prefix: '/api/v1' });

	app.register(require('@scalar/fastify-api-reference'), {
		routePrefix: process.env.DOCS_PREFIX || '/docs',
		configuration: {
			title: 'FHIR Parser - Docs',
			theme: 'elysiajs',
			hideModels: true,
			darkMode: true,
			forceDarkModeState: 'dark',
			hideDarkModeToggle: true,
			defaultHttpClient: {
				targetKey: 'node',
				clientKey: 'fetch',
			},
			metaData: {
				title: 'FHIR Parser - Docs',
				description: 'Documentação',
			},
		},
	});

	return app;
}
