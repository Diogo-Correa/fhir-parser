import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ProcessStructureDefinitionBody } from '../schemas/structure-definition.schema';
import { processAndStoreStructureDefinition } from '../services/structure-definition.service';

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
			reply.status(200).send(result);
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
