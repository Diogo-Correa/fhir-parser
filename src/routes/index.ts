import type { FastifyInstance } from 'fastify';
import { mappingConfigurationRoutes } from './mapping.routes';
import { structureDefinitionRoutes } from './structure-definition.routes';
import { transformRoutes } from './transform.routes';

export async function appRoutes(app: FastifyInstance): Promise<void> {
	app.register(transformRoutes, { prefix: '/transform' });
	app.register(structureDefinitionRoutes, { prefix: '/structure-definition' });
	app.register(mappingConfigurationRoutes, {
		prefix: '/mapping-configuration',
	});

	app.get('/health', async (_, reply) => {
		reply.code(200).send({ status: 'ok', timestamp: new Date() });
	});
}
