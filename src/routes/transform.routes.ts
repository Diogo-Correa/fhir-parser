import type { FastifyInstance } from 'fastify';
import {
	handleTransformByFile,
	handleTransformRequest,
} from '../controllers/transform.controller'; //
import { $ref } from '../schemas/transform.schema'; //

export async function transformRoutes(app: FastifyInstance) {
	app.post(
		'/',
		{
			schema: {
				// Para a rota '/' que espera JSON, o schema.body está correto
				tags: ['Transformation'],
				summary: 'Transform data based on a mapping configuration',
				description:
					'Receives JSON data in the request body, transforms it according to the specified mapping configuration, and returns the transformed data. Supports TO_FHIR (data to FHIR) and FROM_FHIR (fhirQueryPath to JSON/CSV) transformations.',
				body: $ref('transformBodySchema'), // CORRETO para application/json
				response: {
					200: {
						description: 'Transformation successful or partially successful.',
						content: {
							'application/json': { schema: $ref('transformResponseSchema') },
						},
					},
					400: {
						description:
							'Bad request, such as invalid input data, invalid mapping configuration, or other client-side errors.',
						content: {
							'application/json': { schema: $ref('transformResponseSchema') },
						},
					},
					404: {
						description: 'Mapping configuration not found.',
						content: {
							'application/json': { schema: $ref('transformResponseSchema') },
						},
					},
					500: {
						description: 'Internal server error during transformation.',
						content: {
							'application/json': { schema: $ref('transformResponseSchema') },
						},
					},
					502: {
						description:
							'Bad gateway, error communicating with an external FHIR server.',
						content: {
							'application/json': { schema: $ref('transformResponseSchema') },
						},
					},
				},
			},
		},
		handleTransformRequest,
	);

	app.post(
		'/file',
		{
			schema: {
				tags: ['Transformation'],
				summary: 'Transform data from an uploaded file',
				description:
					'Receives a file (e.g., CSV, JSON) and transformation parameters as multipart/form-data. Transforms the file content based on the mapping configuration. Validation of form parts is handled internally by the controller.',
				consumes: ['multipart/form-data'],
				requestBody: {
					required: true,
					content: {
						'multipart/form-data': {
							schema: {
								type: 'object',
								required: ['mappingConfigName', 'file'],
								properties: {
									mappingConfigName: {
										type: 'string',
										description: 'Name of the mapping configuration to use.',
									},
									sendToFhirServer: {
										type: 'boolean',
										description:
											'(Optional) Send the transformed FHIR resources to the FHIR server. Defaults to false.',
									},
									fhirServerUrlOverride: {
										type: 'string',
										format: 'url',
										description:
											'(Optional) Override the default FHIR server URL.',
									},
									fhirQueryPath: {
										type: 'string',
										description:
											'(Optional) FHIR query path for FROM_FHIR transformations (e.g., /Patient?name=John).',
									},
									file: {
										type: 'string',
										format: 'binary',
										description:
											'The file to be transformed (e.g., CSV, JSON, NDJSON).',
									},
								},
							},
						},
					},
				},
				response: {
					200: {
						description: 'Transformation successful or partially successful.',
						content: {
							'application/json': { schema: $ref('transformResponseSchema') },
						},
					},
					400: {
						description:
							'Bad request due to invalid file, missing parameters, invalid mapping configuration, or other client-side errors.',
						content: {
							'application/json': { schema: $ref('transformResponseSchema') },
						},
					},
					404: {
						description: 'Mapping configuration not found.',
						content: {
							'application/json': { schema: $ref('transformResponseSchema') },
						},
					},
					500: {
						description: 'Internal server error during file transformation.',
						content: {
							'application/json': { schema: $ref('transformResponseSchema') },
						},
					},
					502: {
						description:
							'Bad gateway, error communicating with an external FHIR server.',
						content: {
							'application/json': { schema: $ref('transformResponseSchema') },
						},
					},
				},
			},
		},
		handleTransformByFile,
	);
}
