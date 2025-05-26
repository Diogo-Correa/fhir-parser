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
				description:
					'Creates a new mapping configuration along with its field mappings. The configuration name must be unique.',
				body: $ref('createMappingConfigurationSchema'),
				response: {
					201: {
						description: 'Mapping configuration created successfully.',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										message: { type: 'string' },
										success: { type: 'boolean', example: true },
										data: $ref('mappingConfigurationResponseSchema'),
									},
								},
							},
						},
					},
					400: {
						description: 'Invalid input or mapping logic error.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
					409: {
						description: 'Mapping configuration with this name already exists.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
					500: {
						description: 'Internal server error.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
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
				description:
					'Retrieves a list of all mapping configurations. Use the `includeFields` query parameter to include detailed field mappings.',
				querystring: {
					type: 'object',
					properties: {
						includeFields: {
							type: 'string',
							enum: ['true', 'false', '1', '0'],
							description:
								'Set to true or 1 to include all field mappings. Defaults to false.',
						},
					},
				},
				response: {
					200: {
						description: 'A list of mapping configurations.',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										message: { type: 'string' },
										success: { type: 'boolean', example: true },
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
					500: {
						description: 'Internal server error.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
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
				summary: 'Get a specific Mapping Configuration by name or CUID',
				description:
					'Retrieves a single mapping configuration, including its field mappings, by its unique name or CUID.',
				params: $ref('mappingIdentifierParamSchema'),
				response: {
					200: {
						description: 'The requested mapping configuration.',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										message: { type: 'string' },
										success: { type: 'boolean', example: true },
										data: $ref('mappingConfigurationResponseSchema'),
									},
								},
							},
						},
					},
					404: {
						description: 'Mapping configuration not found.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
					422: {
						description:
							'Mapping configuration found but is currently invalid.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
					500: {
						description: 'Internal server error.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
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
				summary: 'Update a Mapping Configuration by name or CUID',
				description:
					"Updates an existing mapping configuration. If 'fieldMappings' are provided in the body, they will replace all existing field mappings for this configuration. Otherwise, only the top-level configuration properties are updated.",
				params: $ref('mappingIdentifierParamSchema'),
				body: $ref('updateMappingConfigurationSchema'),
				response: {
					200: {
						description: 'Mapping configuration updated successfully.',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										message: { type: 'string' },
										success: { type: 'boolean', example: true },
										data: $ref('mappingConfigurationResponseSchema'),
									},
								},
							},
						},
					},
					400: {
						description: 'Invalid input or mapping logic error.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
					404: {
						description: 'Mapping configuration not found.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
					409: {
						description:
							'Mapping configuration with the new name already exists.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
					500: {
						description: 'Internal server error.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
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
				summary: 'Delete a Mapping Configuration by name or CUID',
				description:
					'Deletes a mapping configuration and its associated field mappings (due to cascade delete).',
				params: $ref('mappingIdentifierParamSchema'),
				response: {
					200: {
						description: 'Mapping configuration deleted successfully.',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										message: { type: 'string' },
										success: { type: 'boolean', example: true },
									},
								},
							},
						},
					},
					404: {
						description: 'Mapping configuration not found.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
					500: {
						description: 'Internal server error.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
				},
			},
		},
		handleDeleteMappingConfiguration,
	);
}
