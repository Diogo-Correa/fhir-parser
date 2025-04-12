import 'dotenv/config';
import { buildServer } from '../lib/fastify';

const start = async () => {
	const app = await buildServer();
	const port = Number.parseInt(process.env.PORT || '3333', 10);

	try {
		await app.listen({ port, host: '0.0.0.0' });
		app.log.info(`Server listening on port ${port}`);
	} catch (err) {
		app.log.error(err);
		process.exit(1);
	}
};

start();
