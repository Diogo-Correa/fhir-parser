import type { FastifyReply, FastifyRequest } from 'fastify';
import type { TransformRequestBody } from '../schemas/transform.schema';
import { InvalidInputDataError } from '../services/errors/InvalidInputDataError';
import { MappingConfigurationNotFoundError } from '../services/errors/MappingConfigurationNotFoundError';

export async function handleTransformRequest(
	request: FastifyRequest<{ Body: TransformRequestBody }>,
	reply: FastifyReply,
) {
	const { mappingConfigName, data, sendToFhirServer, fhirServerUrlOverride } =
		request.body;

	try {
		const result = await transformData({
			mappingConfigName,
			inputData: data,
			sendToFhir: sendToFhirServer,
			fhirServerUrlOverride,
		});

		reply.header('Content-Type', result.contentType);
		reply.send(result.transfomedData);
	} catch (error) {
		if (error instanceof MappingConfigurationNotFoundError)
			reply.notFound(`Mapping configuration '${mappingConfigName}' not found`);
		if (error instanceof InvalidInputDataError)
			reply.badRequest(`Invalid input data: ${error.message}`);

		request.log.error(
			error,
			`Error during transformation for mapping '${mappingConfigName}'`,
		);

		reply.internalServerError(
			'An unexpected error occurred during data transformation.',
		);
	}
}
