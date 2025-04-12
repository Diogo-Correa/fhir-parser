import { PrismaClient } from '@prisma/client/extension';

export const db = new PrismaClient({
	log:
		process.env.NODE_ENV === 'development'
			? ['query', 'info', 'warn', 'error']
			: ['error'],
});
