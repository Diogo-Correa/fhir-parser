import crypto from 'node:crypto';

interface CacheKeyParams {
	mappingConfigName: string;
	sendToFhirServer?: boolean | string;
	fhirServerUrlOverride?: string | null;
	inputDataHash?: string;
	fhirQueryPath?: string | null;
}

export function generateCacheKey(
	prefix: string,
	params: CacheKeyParams,
): string {
	const relevantParams: any = {
		mappingConfigName: params.mappingConfigName,
		sendToFhirServer:
			typeof params.sendToFhirServer === 'string'
				? params.sendToFhirServer.toLowerCase() === 'true'
				: Boolean(params.sendToFhirServer),
		fhirServerUrlOverride: params.fhirServerUrlOverride || null,
	};

	if (params.inputDataHash) {
		relevantParams.inputDataHash = params.inputDataHash;
	}
	if (params.fhirQueryPath) {
		relevantParams.fhirQueryPath = params.fhirQueryPath;
	}

	const payloadString = JSON.stringify(
		relevantParams,
		Object.keys(relevantParams).sort(),
	);
	const hash = crypto.createHash('sha256').update(payloadString).digest('hex');
	return `${prefix}:${hash}`;
}
