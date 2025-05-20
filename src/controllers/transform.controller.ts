import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
	type TransformBodyParams,
	transformBodySchema,
} from '../schemas/transform.schema';

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FhirClientError } from '../services/errors/FhirClientError';
import { InvalidInputDataError } from '../services/errors/InvalidInputDataError';
import { InvalidMappingError } from '../services/errors/InvalidMappingError';
import { MappingConfigurationNotFoundError } from '../services/errors/MappingConfigurationNotFoundError';
import { StructureDefinitionNotProcessedError } from '../services/errors/StructureDefinitionNotProcessedError';
import { streamTransformData } from '../services/transform.service';

export async function handleTransformRequest(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	let params: TransformBodyParams | undefined = undefined; // Initialize to undefined
	let inputStream: Readable | undefined;
	let sourceContentType: string | undefined = request.headers['content-type'];

	try {
		if (request.isMultipart()) {
			request.log.info('Multipart request detected for transformation');

			const filePart = await request.file({});
			params = filePart?.fields as unknown as TransformBodyParams;

			if (filePart) {
				inputStream = filePart.file;
				sourceContentType = filePart.mimetype;
				request.log.info(
					`Multipart file received: ${filePart.filename} (type: ${sourceContentType}) for mapping: ${params.mappingConfigName}`,
				);
			} else if (!params.fhirQueryPath) {
				// TO_FHIR precisa de dados (inline ou arquivo)
				// Se params.data (inline JSON) também não estiver presente (o schema permite opcional), é um erro
				if (!params.data) {
					request.log.warn(
						'Multipart request for TO_FHIR is missing a file part and no inline data provided.',
					);
					reply.status(400).send({
						message:
							'File part or inline "data" field is required for TO_FHIR transformation via multipart.',
					});
					return;
				}
				// Se tem params.data, ele será usado (JSON inline via multipart, menos comum mas possível)
				// Converte o 'data' dos campos multipart em stream
				const jsonDataString = JSON.stringify(params.data);
				inputStream = Readable.from(jsonDataString);
				sourceContentType = 'application/json'; // Assume que é JSON
			}
			// Se for FROM_FHIR (params.fhirQueryPath existe), inputStream pode ser undefined (OK)
		} else if (sourceContentType?.includes('application/json')) {
			request.log.info('Application/json request detected for transformation');
			const validatedBody = transformBodySchema.safeParse(request.body);
			if (!validatedBody.success) {
				request.log.error(
					{ errors: validatedBody.error.flatten() },
					'JSON body validation failed',
				);
				reply.status(400).send({
					message: 'Invalid JSON body',
					errors: validatedBody.error.flatten().fieldErrors,
				});
				return;
			}

			if (!validatedBody.success)
				throw new Error('Validation failed, params are undefined.');

			params = validatedBody.data;

			if (params.data) {
				// TO_FHIR com dados JSON inline
				const jsonDataString = JSON.stringify(params.data);
				inputStream = Readable.from(jsonDataString);
				// sourceContentType já é application/json
			} else if (params.fhirQueryPath) {
				// FROM_FHIR
				inputStream = undefined; // Será gerado pelo serviço a partir do fhirQueryPath
				sourceContentType = undefined;
			} else {
				request.log.warn(
					'JSON request for TO_FHIR missing "data" field, and not a FROM_FHIR request.',
				);
				reply.status(400).send({
					message:
						'JSON request for TO_FHIR must contain "data" field, or "fhirQueryPath" for FROM_FHIR.',
				});
				return;
			}
		} else {
			request.log.warn(
				`Unsupported Content-Type for transformation: ${sourceContentType}`,
			);
			reply.status(415).send({
				message: `Unsupported Content-Type: ${sourceContentType}. Use application/json or multipart/form-data.`,
			});
			return;
		}

		// Chama o serviço
		const { outputStream, outputContentType } = await streamTransformData({
			mappingConfigName: params.mappingConfigName,
			inputStream: inputStream,
			sourceContentType: sourceContentType,
			sendToFhir: params?.sendToFhirServer,
			fhirServerUrlOverride: params.fhirServerUrlOverride,
		});

		reply.header('Content-Type', outputContentType);
		await pipeline(outputStream, reply.raw);
	} catch (error: any) {
		request.log.error(
			error,
			`Error during transformation. Mapping: '${
				params?.mappingConfigName ||
				(request.body as any)?.mappingConfigName ||
				(request.query as any)?.mappingConfigName ||
				'unknown'
			}' `,
		);

		if (reply.sent || reply.raw.writableEnded) {
			request.log.info(
				{ sent: reply.sent, writableEnded: reply.raw.writableEnded },
				'Response already sent or stream ended, controller catch block will not send an additional error response.',
			);
			return;
		}

		if (error instanceof MappingConfigurationNotFoundError)
			return reply
				.status(404)
				.send({ message: error.message, code: 'MAPPING_NOT_FOUND' });

		if (error instanceof StructureDefinitionNotProcessedError)
			return reply
				.status(400)
				.send({ message: error.message, code: 'STRUCTURE_DEFINITION_MISSING' });

		if (error instanceof InvalidMappingError)
			return reply.status(400).send({
				message: error.message,
				code: 'INVALID_MAPPING_PATH',
				details: {
					path: error.invalidPath,
					mapping: error.mappingName,
					sd: error.structureDefinitionUrl,
				},
			});

		if (error instanceof InvalidInputDataError)
			return reply
				.status(400)
				.send({ message: error.message, code: 'INVALID_INPUT' });

		if (error instanceof FhirClientError)
			return reply.status(502).send({
				message: `FHIR client/server error: ${error.message}`,
				code: 'FHIR_CLIENT_ERROR',
				details: error.responseData,
			});

		// Captura erros de Zod que podem não ter sido pegos antes
		if (error instanceof z.ZodError) {
			request.log.error(
				{ errors: error.flatten() },
				'Zod validation error in controller catch block',
			);
			return reply.status(400).send({
				message: 'Request parameter validation failed',
				errors: error.flatten().fieldErrors,
			});
		}

		// Fallback for any other errors if response not yet sent
		request.log.warn(
			error,
			'Unhandled error type in controller catch block or error occurred before specific handlers. Sending generic 500.',
		);

		return reply.status(500).send({
			message: 'An unexpected internal error occurred.',
			code: 'INTERNAL_SERVER_ERROR',
		});
	}
}
