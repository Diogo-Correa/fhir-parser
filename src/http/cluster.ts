import cluster from 'node:cluster';
import os from 'node:os';
import { start } from './server';

if (cluster.isPrimary) {
	const numCPUs = os.cpus().length;

	for (let i = 0; i < numCPUs; i++) cluster.fork();

	cluster.on('exit', () => cluster.fork());

	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);

	function shutdown() {
		for (const id in cluster.workers) cluster.workers[id]?.send('shutdown');

		setTimeout(() => {
			process.exit(0);
		}, 1000).unref();
	}
} else {
	start();
}
