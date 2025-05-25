import type { Readable } from 'node:stream';
import type { FieldProcessingError } from './FieldProcessing';

export interface StreamTransformServiceParams {
	mappingConfigName: string;
	inputStream?: Readable; // Para TO_FHIR
	sourceContentType?: string; // Para TO_FHIR
	fhirQueryPath?: string | undefined | null;
	sendToFhir?: boolean; // Apenas TO_FHIR
	fhirServerUrlOverride?: string | undefined | null;
}

export interface StreamTransformResult {
	outputStream: Readable;
	outputContentType: string;
}

export interface StreamItemError {
	_isTransformError: true; // Flag para identificar erros
	errors: FieldProcessingError[];
	originalItem: any; // O chunk original que falhou
}
