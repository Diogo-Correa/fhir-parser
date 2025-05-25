import Redis from 'ioredis';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = Number.parseInt(process.env.REDIS_PORT || '6379', 10);
const redisPassword = process.env.REDIS_PASSWORD || 'my_master_password';
const cacheDefaultTTL = Number.parseInt(
	process.env.CACHE_DEFAULT_TTL_SECONDS || '3600',
	10,
); // TTL padrão de 1 hora

export const redis = new Redis({
	host: redisHost,
	port: redisPort,
	password: redisPassword,
	maxRetriesPerRequest: 3,
	enableReadyCheck: true,
});

export const DEFAULT_CACHE_TTL = cacheDefaultTTL;

redis.on('connect', () => {
	console.log('Connected to Redis server.');
});

redis.on('error', (err) => {
	console.error('Redis connection error:', err);
});
export async function checkRedisHealth(): Promise<{
	status: string;
	message?: string;
}> {
	try {
		const pong = await redis.ping();
		if (pong === 'PONG') {
			return { status: 'ok' };
		}
		return { status: 'error', message: 'Ping/Pong failed' };
	} catch (error: any) {
		return { status: 'error', message: error.message };
	}
}
