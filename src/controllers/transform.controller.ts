import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	type TransformBodyParams,
	type TransformFileParams,
	transformFileSchema,
} from '../schemas/transform.schema';

import crypto from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DEFAULT_CACHE_TTL, redis } from '../lib/redis';
import { MultipartRequestError } from '../services/errors/MultipartRequestError';
import { streamTransformData } from '../services/transform.service';
import { generateCacheKey } from '../utils/cacheKeyGenerator';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
		stream.on('error', reject);
		stream.on('end', () => resolve(Buffer.concat(chunks)));
	});
}

export async function handleTransformRequest(
	request: FastifyRequest<{ Body: TransformBodyParams }>,
	reply: FastifyReply,
) {
	const {
		data,
		mappingConfigName,
		fhirQueryPath,
		fhirServerUrlOverride,
		sendToFhirServer,
	} = request.body;

	let inputStream: Readable | undefined;
	let sourceContentType: string | undefined = request.headers['content-type'];
	let inputDataHash: string | undefined;
	let cachePrefix: string;

	if (data) {
		const dataString = JSON.stringify(data);
		inputDataHash = crypto
			.createHash('sha256')
			.update(dataString)
			.digest('hex');
		inputStream = Readable.from(
			data.map((item) => JSON.stringify(item)).join('\n'),
		);
		sourceContentType = 'application/x-ndjson';
		cachePrefix = 'transform_json';
	} else if (fhirQueryPath) {
		request.log.info('JSON request with "fhirQueryPath" for transformation.');
		inputStream = undefined;
		cachePrefix = 'transform_from_fhir';
	} else {
		request.log.warn(
			'JSON request missing "data" (for TO_FHIR) or "fhirQueryPath" (for FROM_FHIR).',
		);
		return reply.status(400).send({
			message:
				'Request must contain "data" field (for TO_FHIR) or "fhirQueryPath" (for FROM_FHIR).',
		});
	}

	const cacheKey = generateCacheKey(cachePrefix, {
		mappingConfigName,
		sendToFhirServer,
		fhirServerUrlOverride,
		inputDataHash,
		fhirQueryPath: fhirQueryPath,
	});

	try {
		const cachedResult = await redis.get(cacheKey);
		if (cachedResult) {
			request.log.info(`Cache hit for key: ${cacheKey}`);
			reply.header('Content-Type', 'application/json');
			reply.header('X-Cache', 'hit');
			return reply.send(cachedResult);
		}
		request.log.info(
			`Cache miss for key: ${cacheKey}. Processing transformation.`,
		);
		reply.header('X-Cache', 'miss');
	} catch (cacheError: any) {
		request.log.error(
			`Redis GET error for key ${cacheKey}: ${cacheError.message}. Proceeding without cache.`,
		);
	}

	const { outputStream } = await streamTransformData({
		mappingConfigName: mappingConfigName,
		inputStream: inputStream,
		fhirQueryPath: fhirQueryPath,
		sourceContentType: sourceContentType,
		sendToFhir: sendToFhirServer,
		fhirServerUrlOverride: fhirServerUrlOverride,
	});

	const responseDataItems: any[] = [];
	const processingErrors: any[] = [];

	const streamProcessor = new Writable({
		objectMode: true,
		write(chunk, encoding, callback) {
			try {
				const output = JSON.parse(chunk.toString());

				if (output.type === 'data') {
					responseDataItems.push(output.item);
				} else if (output.type === 'error') {
					processingErrors.push(output.error);
				}
				callback();
			} catch (err) {
				request.log.error(
					'Error parsing chunk from outputStream:',
					err,
					'Chunk:',
					chunk.toString(),
				);
				processingErrors.push({
					type: 'ChunkParseError',
					message: (err as Error).message,
					chunk: `${chunk.toString().substring(0, 100)}...`,
				});
				callback();
			}
		},
	});

	try {
		await pipeline(outputStream, streamProcessor);

		const finalJsonResponse = {
			success: true,
			message: 'ETL executado',
			data: responseDataItems,
			errors: processingErrors,
		};
		const finalJsonResponseString = JSON.stringify(finalJsonResponse);

		try {
			await redis.set(
				cacheKey,
				finalJsonResponseString,
				'EX',
				DEFAULT_CACHE_TTL,
			);
			request.log.info(`Result for key ${cacheKey} stored in cache.`);
		} catch (cacheError: any) {
			request.log.error(
				`Redis SET error for key ${cacheKey}: ${cacheError.message}.`,
			);
		}

		reply.header('Content-Type', 'application/json');
		reply.send(finalJsonResponseString);
	} catch (err: any) {
		request.log.error('Error in pipeline processing for JSON request:', err);
		const errorResponse = {
			success: false,
			message: 'Stream processing error',
			data: responseDataItems,
			errors: [
				...processingErrors,
				{ type: 'PipelineError', message: err.message, stack: err.stack },
			],
		};
		const errorResponseString = JSON.stringify(errorResponse);

		if (!reply.sent) {
			reply
				.status(500)
				.header('Content-Type', 'application/json')
				.send(errorResponseString);
		}
	}
}

export async function handleTransformByFile(
	request: FastifyRequest<{ Body: TransformFileParams }>,
	reply: FastifyReply,
) {
	if (!request.isMultipart()) {
		throw new MultipartRequestError(
			'Invalid request. Expected multipart/form-data.',
		);
	}

	const filePart = await request.file({});
	if (!filePart?.file) {
		throw new MultipartRequestError('File part is missing in the request.');
	}

	const getFieldValue = (field: any): string | undefined => {
		if (field && field.value !== undefined) return String(field.value);
		return undefined;
	};

	const mappingConfigName = getFieldValue(filePart.fields.mappingConfigName);
	if (!mappingConfigName) {
		return reply
			.status(400)
			.send({ message: 'mappingConfigName is required.', success: false });
	}

	const sendToFhirServerRaw = getFieldValue(filePart.fields.sendToFhirServer);
	const sendToFhirServer = sendToFhirServerRaw?.toLowerCase() === 'true';
	const fhirServerUrlOverride = getFieldValue(
		filePart.fields.fhirServerUrlOverride,
	);
	const fhirQueryPath = getFieldValue(filePart.fields.fhirQueryPath);

	transformFileSchema.parse({
		mappingConfigName,
		sendToFhirServer,
		fhirServerUrlOverride,
		fhirQueryPath,
		file: filePart.file,
	});

	const sourceContentType = filePart.mimetype;
	let inputDataHash: string;
	let fileBuffer: Buffer;

	try {
		fileBuffer = await streamToBuffer(filePart.file);
		inputDataHash = crypto
			.createHash('sha256')
			.update(fileBuffer)
			.digest('hex');
	} catch (bufferError: any) {
		request.log.error('Error buffering file for hashing:', bufferError);
		return reply
			.status(500)
			.send({ message: 'Error processing file.', success: false });
	}

	const cachePrefix = 'transform_file';
	const cacheKey = generateCacheKey(cachePrefix, {
		mappingConfigName,
		sendToFhirServer,
		fhirServerUrlOverride,
		inputDataHash,
		fhirQueryPath,
	});

	try {
		const cachedResult = await redis.get(cacheKey);
		if (cachedResult) {
			request.log.info(`Cache hit for key: ${cacheKey}`);
			reply.header('Content-Type', 'application/json');
			reply.header('X-Cache', 'hit');
			return reply.send(cachedResult);
		}
		request.log.info(
			`Cache miss for key: ${cacheKey}. Processing transformation.`,
		);
		reply.header('X-Cache', 'miss');
	} catch (cacheError: any) {
		request.log.error(
			`Redis GET error for key ${cacheKey}: ${cacheError.message}. Proceeding without cache.`,
		);
	}

	const inputStream = Readable.from(fileBuffer);

	const { outputStream } = await streamTransformData({
		mappingConfigName: mappingConfigName,
		inputStream: inputStream,
		sourceContentType: sourceContentType,
		fhirQueryPath: fhirQueryPath,
		sendToFhir: sendToFhirServer,
		fhirServerUrlOverride: fhirServerUrlOverride,
	});

	const responseDataItems: any[] = [];
	const processingErrors: any[] = [];

	const streamProcessor = new Writable({
		objectMode: true,
		write(chunk, encoding, callback) {
			try {
				const output = JSON.parse(chunk.toString());
				if (output.type === 'data') {
					responseDataItems.push(output.item);
				} else if (output.type === 'error') {
					processingErrors.push(output.error);
				}
				callback();
			} catch (err) {
				request.log.error(
					'Error parsing chunk from outputStream (file):',
					err,
					'Chunk:',
					chunk.toString(),
				);
				processingErrors.push({
					type: 'ChunkParseError',
					message: (err as Error).message,
					chunk: `${chunk.toString().substring(0, 100)}...`,
				});
				callback();
			}
		},
	});

	try {
		await pipeline(outputStream, streamProcessor);

		const finalJsonResponse = {
			success: true,
			message: 'ETL executado com arquivo',
			data: responseDataItems,
			errors: processingErrors,
		};
		const finalJsonResponseString = JSON.stringify(finalJsonResponse);

		try {
			await redis.set(
				cacheKey,
				finalJsonResponseString,
				'EX',
				DEFAULT_CACHE_TTL,
			);
			request.log.info(`Result for key ${cacheKey} stored in cache (file).`);
		} catch (cacheError: any) {
			request.log.error(
				`Redis SET error for key ${cacheKey}: ${cacheError.message} (file).`,
			);
		}

		reply.header('Content-Type', 'application/json');
		reply.send(finalJsonResponseString);
	} catch (err: any) {
		request.log.error('Error in pipeline processing for file request:', err);
		const errorResponse = {
			success: false,
			message: 'Stream processing error (file)',
			data: responseDataItems,
			errors: [
				...processingErrors,
				{ type: 'PipelineError', message: err.message, stack: err.stack },
			],
		};
		const errorResponseString = JSON.stringify(errorResponse);
		if (!reply.sent) {
			reply
				.status(500)
				.header('Content-Type', 'application/json')
				.send(errorResponseString);
		}
	}
}
