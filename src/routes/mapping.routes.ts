import type { FastifyInstance } from 'fastify';
import {
	handleCreateMappingConfiguration,
	handleDeleteMappingConfiguration,
	handleGetAllMappingConfigurations,
	handleGetMappingConfiguration,
	handleUpdateMappingConfiguration,
} from '../controllers/mapping.controller';
import { $ref } from '../schemas/mapping.schema';

export async function mappingConfigurationRoutes(app: FastifyInstance) {
	app.post(
		'/',
		{
			schema: {
				tags: ['MappingConfiguration'],
				summary: 'Create a new Mapping Configuration',
				body: $ref('createMappingConfigurationSchema'),
				response: {
					201: $ref('mappingConfigurationResponseSchema'),
				},
			},
		},
		handleCreateMappingConfiguration,
	);

	app.get(
		'/',
		{
			schema: {
				tags: ['MappingConfiguration'],
				summary: 'Get all Mapping Configurations',
				querystring: {
					type: 'object',
					properties: {
						includeFields: {
							type: 'string',
							enum: ['true', 'false', '1', '0'],
							description: 'Set to true to include all field mappings.',
						},
					},
				},
				response: {
					200: {
						type: 'object',
						properties: {
							message: { type: 'string' },
							success: { type: 'boolean' },
							data: {
								type: 'array',
								items: {
									oneOf: [
										$ref('mappingConfigurationResponseSchema'),
										$ref('mappingConfigurationSummaryResponseSchema'),
									],
								},
							},
						},
					},
				},
			},
		},
		handleGetAllMappingConfigurations,
	);

	app.get(
		'/:identifier',
		{
			schema: {
				tags: ['MappingConfiguration'],
				summary: 'Get a specific Mapping Configuration by name or ID',
				params: $ref('mappingIdentifierParamSchema'),
				response: {
					200: $ref('mappingConfigurationResponseSchema'),
				},
			},
		},
		handleGetMappingConfiguration,
	);

	app.put(
		'/:identifier',
		{
			schema: {
				tags: ['MappingConfiguration'],
				summary: 'Update a Mapping Configuration by name or ID',
				params: $ref('mappingIdentifierParamSchema'),
				body: $ref('updateMappingConfigurationSchema'),
				response: {
					200: $ref('mappingConfigurationResponseSchema'),
				},
			},
		},
		handleUpdateMappingConfiguration,
	);

	app.delete(
		'/:identifier',
		{
			schema: {
				tags: ['MappingConfiguration'],
				summary: 'Delete a Mapping Configuration by name or ID',
				params: $ref('mappingIdentifierParamSchema'),
				response: {
					200: {
						type: 'object',
						properties: {
							message: { type: 'string' },
							success: { type: 'boolean' },
						},
					},
				},
			},
		},
		handleDeleteMappingConfiguration,
	);
}
