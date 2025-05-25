import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ValidateMappingConfigurationDryRunInput } from '../schemas/mappingUtility.schema';
import {
	getAvailableTransformationTypesService,
	getAvailableValidationTypesService,
	validateMappingConfigurationDryRunService,
} from '../services/mappingUtility.service';

export async function handleGetAvailableTransformationTypes(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	try {
		const types = getAvailableTransformationTypesService();
		return reply.status(200).send({ types });
	} catch (error: any) {
		request.log.error(error, 'Error retrieving available transformation types');
		return reply.status(500).send({
			success: false,
			message: error.message || 'An unexpected error occurred.',
		});
	}
}

export async function handleGetAvailableValidationTypes(
	request: FastifyRequest,
	reply: FastifyReply,
) {
	try {
		const types = getAvailableValidationTypesService();
		return reply.status(200).send({ types });
	} catch (error: any) {
		request.log.error(error, 'Error retrieving available validation types');
		return reply.status(500).send({
			success: false,
			message: error.message || 'An unexpected error occurred.',
		});
	}
}

export async function handleValidateMappingConfigurationDryRun(
	request: FastifyRequest<{ Body: ValidateMappingConfigurationDryRunInput }>,
	reply: FastifyReply,
) {
	try {
		const result = await validateMappingConfigurationDryRunService(
			request.body,
		);
		if (result.success) {
			return reply.status(200).send(result);
		}
		return reply.status(400).send(result);
	} catch (error: any) {
		request.log.error(
			error,
			`Error during mapping configuration dry run validation for '${request.body.name}'`,
		);
		return reply.status(500).send({
			success: false,
			message:
				error.message ||
				'An unexpected error occurred during validation process.',
		});
	}
}
