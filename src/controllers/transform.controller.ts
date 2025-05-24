// src/controllers/transform.controller.ts (MODIFICADO)
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	type TransformBodyParams,
	transformBodySchema,
} from '../schemas/transform.schema'; // Certifique-se que este schema agora tem 'data' como array opcional

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { streamTransformData } from '../services/transform.service';

export async function handleTransformRequest(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	let params: TransformBodyParams | undefined = undefined;
	let inputStream: Readable | undefined;
	let sourceContentType: string | undefined = request.headers['content-type'];

	if (request.isMultipart()) {
		request.log.info('Multipart request detected for transformation');

		const filePart = await request.file({});
		const rawParamsFromMultipart: any = {};
		if (filePart?.fields) {
			// Coleta todos os campos. 'data' pode ser um campo que precise de JSON.parse se vier como string.
			for (const key in filePart.fields) {
				const field = filePart.fields[key] as any;
				if (key === 'data' && typeof field.value === 'string') {
					try {
						rawParamsFromMultipart[key] = JSON.parse(field.value);
					} catch (e) {
						request.log.warn(
							{ field: key, value: field.value },
							'Failed to parse multipart field "data" as JSON',
						);
						rawParamsFromMultipart[key] = field.value; // Mantém como string se não for JSON válido
					}
				} else {
					rawParamsFromMultipart[key] = field.value;
				}
			}
		}

		// Validar os parâmetros obtidos do multipart
		const validatedMultipartParams = transformBodySchema.safeParse(
			rawParamsFromMultipart,
		);
		if (!validatedMultipartParams.success) {
			request.log.error(
				{ errors: validatedMultipartParams.error.flatten() },
				'Multipart params validation failed',
			);
			reply.status(400).send({
				message: 'Invalid multipart parameters',
				errors: validatedMultipartParams.error.flatten().fieldErrors,
			});
			return;
		}
		params = validatedMultipartParams.data;

		if (filePart?.file) {
			// Checa se filePart.file existe
			inputStream = filePart.file;
			sourceContentType = filePart.mimetype;
			request.log.info(
				`Multipart file received: ${filePart.filename} (type: ${sourceContentType}) for mapping: ${params.mappingConfigName}`,
			);
		} else if (params.data) {
			// 'data' (array de objetos) fornecido via campo multipart
			request.log.info(
				'Multipart request with inline "data" field for transformation.',
			);
			// Converter array de objetos para NDJSON stream
			const ndJsonDataString = params.data
				.map((item) => JSON.stringify(item))
				.join('\n');
			inputStream = Readable.from(ndJsonDataString);
			sourceContentType = 'application/x-ndjson'; // MODIFICADO para NDJSON
		} else if (!params.fhirQueryPath) {
			// TO_FHIR precisa de dados (arquivo ou inline 'data'), mas nenhum foi fornecido
			request.log.warn(
				'Multipart request for TO_FHIR is missing a file part and no inline data provided.',
			);
			reply.status(400).send({
				message:
					'File part or inline "data" field (as an array of objects) is required for TO_FHIR transformation via multipart when fhirQueryPath is not present.',
			});
			return;
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
		params = validatedBody.data;

		if (params.data) {
			// TO_FHIR com dados JSON inline (agora um array de objetos)
			request.log.info(
				'JSON request with "data" field (array of objects) for transformation.',
			);
			// Converter array de objetos para NDJSON stream
			const ndJsonDataString = params.data
				.map((item) => JSON.stringify(item))
				.join('\n');
			inputStream = Readable.from(ndJsonDataString);
			sourceContentType = 'application/x-ndjson'; // MODIFICADO para NDJSON
		} else if (params.fhirQueryPath) {
			// FROM_FHIR
			request.log.info('JSON request with "fhirQueryPath" for transformation.');
			inputStream = undefined;
			// sourceContentType já é application/json, o que pode ser ok para FROM_FHIR
			// ou pode ser irrelevante se nenhum corpo de entrada for realmente lido pelo serviço.
		} else {
			request.log.warn(
				'JSON request for TO_FHIR missing "data" field, and not a FROM_FHIR request.',
			);
			reply.status(400).send({
				message:
					'JSON request for TO_FHIR must contain "data" field (as an array of objects), or "fhirQueryPath" for FROM_FHIR.',
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

	// Verifica se 'params' foi definido. Se não, algo deu muito errado.
	if (!params) {
		request.log.error(
			'Params were not determined before calling service. This should not happen.',
		);
		reply.status(500).send({
			message: 'Internal server error: Could not determine request parameters.',
		});
		return;
	}

	// Chama o serviço
	const { outputStream, outputContentType } = await streamTransformData({
		mappingConfigName: params.mappingConfigName,
		inputStream: inputStream, // Pode ser undefined para FROM_FHIR
		fhirQueryPath: params.fhirQueryPath,
		sourceContentType: sourceContentType, // Agora pode ser 'application/x-ndjson'
		sendToFhir: params?.sendToFhirServer,
		fhirServerUrlOverride: params.fhirServerUrlOverride,
	});

	reply.header('Content-Type', outputContentType);
	await pipeline(outputStream, reply.raw);
}
