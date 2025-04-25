import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
	type ProcessStructureDefinitionBody,
	processStructureDefinitionSchema,
} from '../schemas/structure-definition.schema';
import { processAndStoreStructureDefinition } from '../services/structure-definition.service';

export async function handleProcessStructureDefinition(
	request: FastifyRequest<{ Body: ProcessStructureDefinitionBody }>,
	reply: FastifyReply,
) {
	// Valida o corpo da requisição
	try {
		processStructureDefinitionSchema.parse(request.body);
	} catch (error) {
		if (error instanceof z.ZodError) {
			reply.status(400).send({
				message: 'Invalid request body',
				errors: error.flatten().fieldErrors,
			});
		}
		request.log.error(error, 'Unexpected error validating request body');
		reply.status(500).send({ message: 'Error validating request body.' });
	}

	const { identifier, fhirServerUrl } = request.body;

	try {
		const result = await processAndStoreStructureDefinition(
			identifier,
			fhirServerUrl,
		);

		if (result.success) {
			reply.status(200).send(result);
		}
		// O serviço retorna success: false para erros esperados (ex: not found)
		request.log.warn(
			`Failed to process StructureDefinition '${identifier}': ${result.message}`,
		);
		// Retorna 400 ou 404 dependendo da mensagem? Por simplicidade, 400.
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
