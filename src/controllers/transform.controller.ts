import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
	type TransformApiParams,
	transformApiSchema,
} from '../schemas/transform.schema';
import { FhirClientError } from '../services/errors/FhirClientError';
import { InvalidInputDataError } from '../services/errors/InvalidInputDataError';
import { InvalidMappingError } from '../services/errors/InvalidMappingError';
import { MappingConfigurationNotFoundError } from '../services/errors/MappingConfigurationNotFoundError';
import { StructureDefinitionNotProcessedError } from '../services/errors/StructureDefinitionNotProcessedError';
import { streamTransformData } from '../services/transform.service';
interface TransformRequestFullParams {
	Body?: Partial<TransformApiParams>;
	Querystring?: Partial<TransformApiParams>;
}

export async function handleTransformRequest(
	request: FastifyRequest<TransformRequestFullParams>,
	reply: FastifyReply,
) {
	const contentType = request.headers['content-type'] || '';
	const queryParams = request.query || {};
	// Só parseia body se for JSON (Fastify pode já ter feito)
	const bodyParams =
		contentType.includes('json') &&
		typeof request.body === 'object' &&
		request.body !== null
			? request.body
			: {};

	// Consolida parâmetros (Query tem precedência)
	const params: Partial<TransformApiParams> = {
		mappingConfigName:
			queryParams.mappingConfigName || bodyParams.mappingConfigName,
		sendToFhirServer:
			typeof queryParams.sendToFhirServer === 'string'
				? queryParams.sendToFhirServer.toLowerCase() === 'true'
				: (bodyParams.sendToFhirServer ?? false),
		fhirServerUrlOverride:
			queryParams.fhirServerUrlOverride || bodyParams.fhirServerUrlOverride,
		fhirQueryPath: queryParams.fhirQueryPath || bodyParams.fhirQueryPath,
	};

	// Valida parâmetros consolidados com Zod
	try {
		transformApiSchema.parse(params);
	} catch (error) {
		if (error instanceof z.ZodError) {
			return reply.status(400).send({
				message: 'Invalid request parameters',
				errors: error.flatten().fieldErrors,
			});
		}
		request.log.error(error, 'Unexpected error validating request parameters');
		return reply
			.status(500)
			.send({ message: 'Error validating request parameters.' });
	}

	// Chama o Serviço de Stream
	try {
		const isSupportedInputStream =
			contentType.includes('csv') ||
			contentType.includes('json') ||
			contentType.includes('ndjson');

		const { outputStream, outputContentType } = await streamTransformData({
			mappingConfigName: params.mappingConfigName!, // Zod garante que existe
			inputStream: isSupportedInputStream ? request.raw : undefined,
			sourceContentType: isSupportedInputStream ? contentType : undefined,
			fhirQueryPath: params.fhirQueryPath,
			sendToFhir: params.sendToFhirServer,
			fhirServerUrlOverride: params.fhirServerUrlOverride,
		});

		// Envia Resposta Stream
		reply.header('Content-Type', outputContentType);
		return reply.send(outputStream);
	} catch (error: any) {
		// Tratamento Centralizado de Erros Conhecidos
		if (error instanceof MappingConfigurationNotFoundError) {
			return reply.status(404).send({ message: error.message });
		}
		if (error instanceof StructureDefinitionNotProcessedError) {
			request.log.warn(
				`StructureDefinition Error for mapping '${params.mappingConfigName}': ${error.message}`,
			);
			return reply
				.status(400)
				.send({ message: error.message, code: 'STRUCTURE_DEFINITION_MISSING' });
		}
		if (error instanceof InvalidMappingError) {
			request.log.error(
				`Invalid Mapping Error for '${error.mappingName}': Path '${error.invalidPath}' on SD '${error.structureDefinitionUrl}'`,
			);
			return reply.status(400).send({
				message: error.message,
				code: 'INVALID_MAPPING_PATH',
				details: {
					path: error.invalidPath,
					mapping: error.mappingName,
					sd: error.structureDefinitionUrl,
				},
			});
		}
		if (error instanceof InvalidInputDataError) {
			return reply
				.status(400)
				.send({ message: error.message, code: 'INVALID_INPUT' });
		}
		if (error instanceof FhirClientError) {
			// Erro ao buscar dados FHIR (FROM_FHIR) ou ao enviar (TO_FHIR async)
			// O envio TO_FHIR async não lança erro aqui, apenas loga no serviço.
			// Este erro é mais provável no fetch do FROM_FHIR.
			request.log.error(
				`FHIR Client Error during FROM_FHIR fetch for query '${params.fhirQueryPath}': ${error.message}`,
			);
			// Retorna 502 Bad Gateway se falhou ao buscar do servidor upstream
			return reply.status(502).send({
				message: `Failed to fetch data from FHIR server: ${error.message}`,
				code: 'FHIR_FETCH_FAILED',
				details: error.responseData,
			});
		}

		// Erro genérico/inesperado
		request.log.error(
			error,
			`Unexpected error during stream transformation for mapping '${params.mappingConfigName}'`,
		);

		if (reply.raw.writableEnded) {
			console.error(
				'Error occurred after response stream started - cannot send error response.',
			);
			// Apenas tenta logar
			return;
		}
		// Retorna 500 para erros não tratados
		return reply.status(500).send({
			message:
				'An unexpected internal error occurred during data transformation.',
			code: 'INTERNAL_SERVER_ERROR',
		});
	}
}
