import type { Readable } from 'node:stream';

export interface StreamTransformServiceParams {
	mappingConfigName: string;
	inputStream?: Readable; // Para TO_FHIR
	sourceContentType?: string; // Para TO_FHIR
	fhirQueryPath?: string; // Para FROM_FHIR
	sendToFhir?: boolean; // Apenas TO_FHIR
	fhirServerUrlOverride?: string;
}

export interface StreamTransformResult {
	outputStream: Readable;
	outputContentType: string;
}
