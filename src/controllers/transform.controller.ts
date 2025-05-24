import type { FastifyReply, FastifyRequest } from 'fastify';
import {
	type TransformBodyParams,
	type TransformFileParams,
	transformFileSchema,
} from '../schemas/transform.schema'; // Certifique-se que este schema agora tem 'data' como array opcional

import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MultipartRequestError } from '../services/errors/MultipartRequestError';
import { streamTransformData } from '../services/transform.service';

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

	if (data) {
		const ndJsonDataString = data
			.map((item) => JSON.stringify(item))
			.join('\n');
		inputStream = Readable.from(ndJsonDataString);
		sourceContentType = 'application/x-ndjson';
	} else if (fhirQueryPath) {
		request.log.info('JSON request with "fhirQueryPath" for transformation.');
		inputStream = undefined;
	} else {
		request.log.warn(
			'JSON request for TO_FHIR missing "data" field, and not a FROM_FHIR request.',
		);
		reply.status(400).send({
			message:
				'JSON request for TO_FHIR must contain "data" field (as an array of objects), or "fhirQueryPath" for FROM_FHIR.',
		});
		return;
	}

	const { outputStream } = await streamTransformData({
		mappingConfigName: mappingConfigName,
		inputStream: inputStream,
		fhirQueryPath: fhirQueryPath,
		sourceContentType: sourceContentType,
		sendToFhir: sendToFhirServer,
		fhirServerUrlOverride: fhirServerUrlOverride,
	});

	reply.raw.setHeader('Content-Type', 'application/json');
	reply.raw.write('{"success":true,"message":"ETL executado","data":[');

	const processingErrors: any[] = [];
	let firstDataItem = true;

	const streamProcessor = new Writable({
		write(chunk, encoding, callback) {
			try {
				const output = JSON.parse(chunk.toString());
				if (output.type === 'data') {
					if (!firstDataItem) {
						reply.raw.write(',');
					}
					reply.raw.write(JSON.stringify(output.item));
					firstDataItem = false;
				} else if (output.type === 'error') {
					processingErrors.push(output.error);
				}
				callback();
			} catch (err) {
				callback(err as Error);
			}
		},
	});

	try {
		await pipeline(outputStream, streamProcessor);
		reply.raw.write('],"errors":[');
		for (let i = 0; i < processingErrors.length; i++) {
			if (i > 0) {
				reply.raw.write(',');
			}
			reply.raw.write(JSON.stringify(processingErrors[i]));
		}
		reply.raw.write(']}');
	} catch (err) {
		request.log.error('Error in pipeline processing for JSON request:', err);
		if (!reply.raw.headersSent) {
			reply.status(500).send({
				success: false,
				message: 'Stream processing error',
				data: [],
				errors: [err],
			});
		} else {
			reply.raw.write(
				'],"errors":[{"type":"PipelineError","message":"Stream processing error after data started"}]}',
			);
		}
	} finally {
		if (!reply.raw.writableEnded) {
			reply.raw.end();
		}
	}
}

export async function handleTransformByFile(
	request: FastifyRequest<{ Body: TransformFileParams }>,
	reply: FastifyReply,
) {
	let sourceContentType: string | undefined = request.headers['content-type'];

	if (!request.isMultipart())
		throw new MultipartRequestError(
			'Invalid request. Expected multipart/form-data.',
		);

	const filePart = await request.file({});

	if (!filePart?.file)
		throw new MultipartRequestError('File part is missing in the request.');

	const getFieldValue = (field: any) => {
		if (Array.isArray(field)) {
			return field[0]?.value;
		}
		return field?.value;
	};

	const params: TransformFileParams = {
		mappingConfigName: getFieldValue(filePart.fields.mappingConfigName),
		sendToFhirServer: getFieldValue(filePart.fields.sendToFhirServer),
		fhirServerUrlOverride: getFieldValue(filePart.fields.fhirServerUrlOverride),
		file: filePart.file,
	};

	transformFileSchema.parse(params);

	const inputStream = filePart.file;
	sourceContentType = filePart.mimetype;

	const { outputStream } = await streamTransformData({
		mappingConfigName: params.mappingConfigName,
		inputStream: inputStream,
		fhirQueryPath: params.fhirQueryPath,
		sourceContentType: sourceContentType,
		sendToFhir: params?.sendToFhirServer,
		fhirServerUrlOverride: params.fhirServerUrlOverride,
	});

	reply.raw.setHeader('Content-Type', 'application/json');
	reply.raw.write('{"success":true,"message":"ETL executado","data":[');

	const processingErrors: any[] = [];
	let firstDataItem = true;

	const streamProcessor = new Writable({
		write(chunk, encoding, callback) {
			try {
				const output = JSON.parse(chunk.toString());
				if (output.type === 'data') {
					if (!firstDataItem) {
						reply.raw.write(',');
					}
					reply.raw.write(JSON.stringify(output.item));
					firstDataItem = false;
				} else if (output.type === 'error') {
					processingErrors.push(output.error);
				}
				callback();
			} catch (err) {
				callback(err as Error);
			}
		},
	});

	try {
		await pipeline(outputStream, streamProcessor);
		reply.raw.write('],"errors":[');
		for (let i = 0; i < processingErrors.length; i++) {
			if (i > 0) {
				reply.raw.write(',');
			}
			reply.raw.write(JSON.stringify(processingErrors[i]));
		}
		reply.raw.write(']}');
	} catch (err) {
		request.log.error('Error in pipeline processing for file request:', err);
		if (!reply.raw.headersSent) {
			reply.status(500).send({
				success: false,
				message: 'Stream processing error',
				data: [],
				errors: [err],
			});
		} else {
			reply.raw.write(
				'],"errors":[{"type":"PipelineError","message":"Stream processing error after data started"}]}',
			);
		}
	} finally {
		if (!reply.raw.writableEnded) {
			reply.raw.end();
		}
	}
}
