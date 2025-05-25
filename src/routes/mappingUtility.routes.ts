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
				response: {
					200: $ref('stringListResponseSchema'),
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
				response: {
					200: $ref('stringListResponseSchema'),
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
				body: $ref('validateMappingConfigurationDryRunSchema'),
				response: {
					200: $ref('validationResultResponseSchema'),
					400: $ref('validationResultResponseSchema'),
				},
			},
		},
		handleValidateMappingConfigurationDryRun,
	);
}
