import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
	GetUniqueStructureDefinitionParams,
	ProcessStructureDefinitionBody,
} from '../schemas/structure-definition.schema';
import {
	getAllStructureDefinitions,
	getStructureDefinitionByUrlOrType,
	processAndStoreStructureDefinition,
} from '../services/structure-definition.service';

export async function handleGetStructureDefinition(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	try {
		const data = await getAllStructureDefinitions();
		reply.code(200).send({
			message: 'StructureDefinitions retrieved successfully',
			success: true,
			data,
		});
	} catch (error) {
		request.log.error(
			error,
			'Unexpected error retrieving StructureDefinitions',
		);
		reply.status(500).send({
			message:
				error instanceof Error
					? error.message
					: 'An unexpected error occurred.',
			success: false,
		});
	}
}

export async function handleGetUniqueStructureDefinition(
	request: FastifyRequest<{ Body: GetUniqueStructureDefinitionParams }>,
	reply: FastifyReply,
) {
	const { url, type } = request.body;

	try {
		const data = await getStructureDefinitionByUrlOrType(url, type);
		reply.code(200).send({
			message: 'StructureDefinition retrieved successfully',
			success: true,
			data: data ?? [],
		});
	} catch (error) {
		request.log.error(error, 'Unexpected error retrieving StructureDefinition');
		reply.status(500).send({
			message:
				error instanceof Error
					? error.message
					: 'An unexpected error occurred.',
			success: false,
		});
	}
}

export async function handleProcessStructureDefinition(
	request: FastifyRequest<{ Body: ProcessStructureDefinitionBody }>,
	reply: FastifyReply,
) {
	const { identifier, fhirServerUrl } = request.body;

	try {
		const result = await processAndStoreStructureDefinition(
			identifier,
			fhirServerUrl,
		);

		if (result.success) {
			return reply.status(200).send(result);
		}
		// O serviço retorna success: false para erros esperados (ex: not found)
		request.log.warn(
			`Failed to process StructureDefinition '${identifier}': ${result.message}`,
		);
		// Retorna 400 ou 404 dependendo da mensagem
		reply.status(400).send({ message: result.message, success: false });
	} catch (error: any) {
		// Captura erros inesperados lançados pelo serviço (ex: erro de DB)
		request.log.error(
			error,
			`Unexpected error processing StructureDefinition ${identifier}`,
		);
		reply.status(500).send({
			message: error.message || 'An unexpected error occurred.',
			success: false,
		});
	}
}
