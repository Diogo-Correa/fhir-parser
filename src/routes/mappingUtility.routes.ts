import type { FastifyInstance } from 'fastify';
import {
	handleGetAvailableTransformationTypes,
	handleGetAvailableValidationTypes,
	handleValidateMappingConfigurationDryRun,
} from '../controllers/mappingUtility.controller';
import { $ref } from '../schemas/mappingUtility.schema';

export async function mappingUtilityRoutes(app: FastifyInstance) {
	app.get(
		'/transformation-types',
		{
			schema: {
				tags: ['Mapping Utilities'],
				summary: 'Get available transformation types',
				description:
					'Retrieves a list of all supported transformation types that can be used in field mappings.',
				response: {
					200: {
						description: 'A list of transformation type names.',
						content: {
							'application/json': { schema: $ref('stringListResponseSchema') },
						},
					},
					500: {
						description: 'Internal server error.',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										success: { type: 'boolean' },
										message: { type: 'string' },
									},
								},
							},
						},
					},
				},
			},
		},
		handleGetAvailableTransformationTypes,
	);

	app.get(
		'/validation-types',
		{
			schema: {
				tags: ['Mapping Utilities'],
				summary: 'Get available validation types',
				description:
					'Retrieves a list of all supported validation types that can be used in field mappings.',
				response: {
					200: {
						description: 'A list of validation type names.',
						content: {
							'application/json': { schema: $ref('stringListResponseSchema') },
						},
					},
					500: {
						description: 'Internal server error.',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										success: { type: 'boolean' },
										message: { type: 'string' },
									},
								},
							},
						},
					},
				},
			},
		},
		handleGetAvailableValidationTypes,
	);

	app.post(
		'/validate-mapping',
		{
			schema: {
				tags: ['Mapping Utilities'],
				summary: 'Validate a mapping configuration payload (dry run)',
				description:
					'Submits a mapping configuration payload for validation against its specified StructureDefinition without saving it. Returns a success or failure message, including details of any validation issues.',
				body: $ref('validateMappingConfigurationDryRunSchema'),
				response: {
					200: {
						description: 'The mapping configuration payload is valid.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
					400: {
						description: 'The mapping configuration payload is invalid.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
					500: {
						description: 'Internal server error during validation process.',
						content: {
							'application/json': {
								schema: $ref('validationResultResponseSchema'),
							},
						},
					},
				},
			},
		},
		handleValidateMappingConfigurationDryRun,
	);
}
