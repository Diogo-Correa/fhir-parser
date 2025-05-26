import Redis from 'ioredis';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = Number.parseInt(process.env.REDIS_PORT || '6379', 10);
const redisPassword = process.env.REDIS_PASSWORD || 'my_master_password';
const cacheDefaultTTL = Number.parseInt(
	process.env.CACHE_DEFAULT_TTL_SECONDS || '3600',
	10,
);

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

export const CACHE_PREFIXES = {
	MAPPING_CONFIG: 'mc:',
	STRUCTURE_DEFINITION_WITH_ELEMENTS: 'sd_full:',
	STRUCTURE_DEFINITION_FIXED_DEFAULT: 'sd_fixed_default:',
	STRUCTURE_DEFINITION_MANDATORY: 'sd_mandatory:',
};

export async function getOrSetCache<T>(
	key: string,
	fetchFunction: () => Promise<T | null>,
	ttlSeconds: number = DEFAULT_CACHE_TTL,
): Promise<T | null> {
	try {
		const cachedData = await redis.get(key);
		if (cachedData) {
			return JSON.parse(cachedData) as T;
		}
	} catch (err: any) {
		console.error(
			`[Cache] Redis GET error for key ${key}: ${err.message}. Fetching from source.`,
		);
	}

	const freshData = await fetchFunction();

	if (freshData !== null && freshData !== undefined) {
		try {
			await redis.set(key, JSON.stringify(freshData), 'EX', ttlSeconds);
		} catch (err: any) {
			console.error(`[Cache] Redis SET error for key ${key}: ${err.message}.`);
		}
	}
	return freshData;
}

export async function invalidateCache(
	keysOrPrefix: string | string[],
): Promise<void> {
	try {
		if (typeof keysOrPrefix === 'string' && keysOrPrefix.endsWith('*')) {
			const stream = redis.scanStream({ match: keysOrPrefix, count: 100 });
			const keysToDelete: string[] = [];
			stream.on('data', (resultKeys) => {
				keysToDelete.push(...resultKeys);
			});
			await new Promise((resolve, reject) => {
				stream.on('end', resolve);
				stream.on('error', reject);
			});
			if (keysToDelete.length > 0) {
				await redis.del(...keysToDelete);
				console.log(
					`[Cache] Invalidated ${keysToDelete.length} keys for prefix ${keysOrPrefix}`,
				);
			}
		} else if (Array.isArray(keysOrPrefix) && keysOrPrefix.length > 0) {
			await redis.del(...keysOrPrefix);
			console.log(`[Cache] Invalidated keys: ${keysOrPrefix.join(', ')}`);
		} else if (typeof keysOrPrefix === 'string') {
			await redis.del(keysOrPrefix);
			console.log(`[Cache] Invalidated key: ${keysOrPrefix}`);
		}
	} catch (err: any) {
		console.error(
			`[Cache] Error during cache invalidation for '${keysOrPrefix}': ${err.message}`,
		);
	}
}
