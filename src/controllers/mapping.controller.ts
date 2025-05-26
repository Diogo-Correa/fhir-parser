import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
	CreateMappingConfigurationInput,
	MappingIdentifierParams,
	UpdateMappingConfigurationInput,
} from '../schemas/mapping.schema';
import { InvalidMappingError } from '../services/errors/InvalidMappingError';
import { MappingConfigurationNotFoundError } from '../services/errors/MappingConfigurationNotFoundError';
import { StructureDefinitionNotProcessedError } from '../services/errors/StructureDefinitionNotProcessedError';
import {
	createMappingConfigService,
	deleteMappingConfigService,
	getAllMappingConfigsService,
	getMappingConfigByIdentifierService,
	updateMappingConfigService,
} from '../services/mapping.service';

export async function handleCreateMappingConfiguration(
	request: FastifyRequest<{ Body: CreateMappingConfigurationInput }>,
	reply: FastifyReply,
) {
	try {
		const mappingConfig = await createMappingConfigService(request.body);
		return reply.status(201).send({
			message: 'MappingConfiguration created successfully.',
			success: true,
			data: mappingConfig,
		});
	} catch (error: any) {
		request.log.error(
			error,
			`Error creating MappingConfiguration '${request.body.name}'`,
		);
		if (
			error instanceof StructureDefinitionNotProcessedError ||
			error instanceof InvalidMappingError
		) {
			return reply.status(400).send({ success: false, message: error.message });
		}
		if (
			error.message?.includes('already exists') ||
			error.message?.includes('Unique constraint failed')
		) {
			return reply.status(409).send({
				success: false,
				message: `MappingConfiguration with name '${request.body.name}' already exists.`,
			});
		}
		return reply.status(500).send({
			success: false,
			message: error.message || 'An unexpected error occurred.',
		});
	}
}

export async function handleGetAllMappingConfigurations(
	request: FastifyRequest<{ Querystring: { includeFields?: string } }>,
	reply: FastifyReply,
) {
	try {
		const includeFieldsParam = request.query.includeFields?.toLowerCase();
		const includeFields =
			includeFieldsParam === 'true' || includeFieldsParam === '1';

		const mappingConfigs = await getAllMappingConfigsService(includeFields);

		const responseData = mappingConfigs.map((mc) => {
			const config = mc as any;
			if (includeFields) {
				const { _count, ...rest } = config;
				return rest;
			}
			const { _count, fieldMappings, ...rest } = config;
			return {
				...rest,
				fieldMappingsCount:
					_count?.fieldMappings ??
					(Array.isArray(fieldMappings) ? fieldMappings.length : 0),
			};
		});

		return reply.status(200).send({
			message: 'MappingConfigurations retrieved successfully.',
			success: true,
			data: responseData,
		});
	} catch (error: any) {
		request.log.error(error, 'Error retrieving MappingConfigurations');
		return reply.status(500).send({
			success: false,
			message: error.message || 'An unexpected error occurred.',
		});
	}
}

export async function handleGetMappingConfiguration(
	request: FastifyRequest<{ Params: MappingIdentifierParams }>,
	reply: FastifyReply,
) {
	const { identifier } = request.params;
	try {
		const mappingConfig = await getMappingConfigByIdentifierService(identifier);
		return reply.status(200).send({
			message: 'MappingConfiguration retrieved successfully.',
			success: true,
			data: mappingConfig,
		});
	} catch (error: any) {
		request.log.error(
			error,
			`Error retrieving MappingConfiguration '${identifier}'`,
		);
		if (error instanceof MappingConfigurationNotFoundError) {
			return reply.status(404).send({ success: false, message: error.message });
		}
		if (
			error instanceof StructureDefinitionNotProcessedError ||
			error instanceof InvalidMappingError
		) {
			return reply.status(422).send({ success: false, message: error.message });
		}
		return reply.status(500).send({
			success: false,
			message: error.message || 'An unexpected error occurred.',
		});
	}
}

export async function handleUpdateMappingConfiguration(
	request: FastifyRequest<{
		Body: UpdateMappingConfigurationInput;
		Params: MappingIdentifierParams;
	}>,
	reply: FastifyReply,
) {
	const { identifier } = request.params;
	try {
		const mappingConfig = await updateMappingConfigService(
			identifier,
			request.body,
		);
		return reply.status(200).send({
			message: `MappingConfiguration '${identifier}' updated successfully.`,
			success: true,
			data: mappingConfig,
		});
	} catch (error: any) {
		request.log.error(
			error,
			`Error updating MappingConfiguration '${identifier}'`,
		);
		if (error instanceof MappingConfigurationNotFoundError) {
			return reply.status(404).send({ success: false, message: error.message });
		}
		if (
			error instanceof StructureDefinitionNotProcessedError ||
			error instanceof InvalidMappingError
		) {
			return reply.status(400).send({ success: false, message: error.message });
		}
		if (
			error.message?.includes('already exists') ||
			error.message?.includes('Unique constraint failed')
		) {
			return reply.status(409).send({ success: false, message: error.message });
		}
		return reply.status(500).send({
			success: false,
			message: error.message || 'An unexpected error occurred.',
		});
	}
}

export async function handleDeleteMappingConfiguration(
	request: FastifyRequest<{ Params: MappingIdentifierParams }>,
	reply: FastifyReply,
) {
	const { identifier } = request.params;
	try {
		await deleteMappingConfigService(identifier);
		return reply.status(200).send({
			message: `MappingConfiguration '${identifier}' deleted successfully.`,
			success: true,
		});
	} catch (error: any) {
		request.log.error(
			error,
			`Error deleting MappingConfiguration '${identifier}'`,
		);
		if (error instanceof MappingConfigurationNotFoundError) {
			return reply.status(404).send({ success: false, message: error.message });
		}
		return reply.status(500).send({
			success: false,
			message: error.message || 'An unexpected error occurred.',
		});
	}
}
