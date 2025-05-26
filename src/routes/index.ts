import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cluster from 'node:cluster';
import { mappingConfigurationRoutes } from './mapping.routes';
import { mappingUtilityRoutes } from './mappingUtility.routes';
import { structureDefinitionRoutes } from './structure-definition.routes';
import { transformRoutes } from './transform.routes';

interface WorkerInfo {
	id: number;
	pid: number | undefined;
}
interface ClusterHealthResponse {
	status: string;
	timestamp: Date;
	workerId?: number;
	workerPid?: number;
	clusterMode: boolean;
	workers?: WorkerInfo[];
	error?: string;
}

export async function appRoutes(app: FastifyInstance): Promise<void> {
	app.register(transformRoutes, { prefix: '/transform' });
	app.register(structureDefinitionRoutes, { prefix: '/structure-definition' });
	app.register(mappingConfigurationRoutes, {
		prefix: '/mapping-configuration',
	});
	app.register(mappingUtilityRoutes, { prefix: '/mapping-utilities' });

	app.get(
		'/health',
		{
			schema: {
				tags: ['Health'],
				summary: 'Get application and cluster health status',
				description:
					'Returns the health status of the current worker and, if in cluster mode, information about all active workers in the cluster.',
				response: {
					200: {
						description: 'Successful health check response.',
						type: 'object',
						properties: {
							status: { type: 'string', example: 'ok' },
							timestamp: { type: 'string', format: 'date-time' },
							workerId: {
								type: 'integer',
								nullable: true,
								description:
									'ID of the current worker process handling the request.',
							},
							workerPid: {
								type: 'integer',
								nullable: true,
								description: 'PID of the current worker process.',
							},
							clusterMode: {
								type: 'boolean',
								description:
									'Indicates if the application is running in cluster mode.',
							},
							workers: {
								type: 'array',
								nullable: true,
								description:
									'Information about all active workers in the cluster (if in cluster mode).',
								items: {
									type: 'object',
									properties: {
										id: { type: 'integer', description: "Worker's unique ID." },
										pid: {
											type: 'integer',
											nullable: true,
											description: "Worker's process ID.",
										},
									},
								},
							},
							error: {
								type: 'string',
								nullable: true,
								description:
									'Error message if full cluster info could not be retrieved.',
							},
						},
					},
					500: {
						description:
							'Partial error or failure to retrieve full cluster information.',
						type: 'object',
						properties: {
							status: { type: 'string', example: 'partial_error' },
							timestamp: { type: 'string', format: 'date-time' },
							workerId: { type: 'integer', nullable: true },
							workerPid: { type: 'integer', nullable: true },
							clusterMode: { type: 'boolean' },
							error: {
								type: 'string',
								description: 'Error message detailing the failure.',
							},
						},
					},
				},
			},
		},
		async (request: FastifyRequest, reply: FastifyReply) => {
			const baseResponse: Partial<ClusterHealthResponse> = {
				status: 'ok',
				timestamp: new Date(),
				clusterMode: cluster.isWorker,
			};

			if (cluster.isWorker && process.send) {
				baseResponse.workerId = cluster.worker?.id;
				baseResponse.workerPid = process.pid;

				try {
					const workersPromise = new Promise<WorkerInfo[]>(
						(resolve, reject) => {
							const timeout = setTimeout(() => {
								process.removeListener('message', messageListener);
								reject(
									new Error(
										'Timeout waiting for cluster health response from primary',
									),
								);
							}, 2000);

							const messageListener = (msg: any) => {
								if (msg.cmd === 'clusterHealthResponse' && msg.data) {
									clearTimeout(timeout);
									process.removeListener('message', messageListener);
									resolve(msg.data as WorkerInfo[]);
								}
							};
							process.on('message', messageListener);

							if (process.send) {
								process.send({ cmd: 'getClusterHealth' });
							} else {
								clearTimeout(timeout);
								process.removeListener('message', messageListener);
								reject(
									new Error('process.send is not available on this worker.'),
								);
							}
						},
					);

					baseResponse.workers = await workersPromise;
					reply.code(200).send(baseResponse as ClusterHealthResponse);
				} catch (error: any) {
					request.log.error(error, 'Failed to get cluster health from primary');
					baseResponse.status = 'partial_error';
					baseResponse.error = `Failed to retrieve full cluster info: ${error.message}`;
					reply.code(500).send(baseResponse as ClusterHealthResponse);
				}
			} else {
				if (cluster.isPrimary) {
					baseResponse.clusterMode = false;
				}
				reply.code(200).send(baseResponse as ClusterHealthResponse);
			}
		},
	);
}
