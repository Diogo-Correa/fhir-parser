import cluster from 'node:cluster';
import os from 'node:os';
import { start } from './server';

interface WorkerInfo {
	id: number;
	pid: number | undefined;
}

if (cluster.isPrimary) {
	const numCPUs = os.cpus().length;
	const workersInfo = new Map<number, WorkerInfo>();

	for (let i = 0; i < numCPUs; i++) {
		const worker = cluster.fork();
		workersInfo.set(worker.id, {
			id: worker.id,
			pid: worker.process.pid,
		});
	}

	cluster.on('fork', (worker) => {
		workersInfo.set(worker.id, {
			id: worker.id,
			pid: worker.process.pid,
		});
		worker.on('message', (msg: any) => {
			if (msg.cmd === 'getClusterHealth') {
				const currentWorkers: WorkerInfo[] = [];
				for (const id in cluster.workers) {
					const currentWorker = cluster.workers[id];
					if (currentWorker) {
						currentWorkers.push({
							id: currentWorker.id,
							pid: currentWorker.process.pid,
						});
					}
					currentWorker?.send({
						cmd: 'clusterHealthResponse',
						data: currentWorkers,
					});
				}
			}
		});
	});

	cluster.on('exit', (worker, code, signal) => {
		workersInfo.delete(worker.id);
		const newWorker = cluster.fork();
		workersInfo.set(newWorker.id, {
			id: newWorker.id,
			pid: newWorker.process.pid,
		});
	});

	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);

	function shutdown() {
		for (const id in cluster.workers) {
			cluster.workers[id]?.send('shutdown');
		}
		setTimeout(() => {
			process.exit(0);
		}, 1000).unref();
	}
} else {
	start();
}
