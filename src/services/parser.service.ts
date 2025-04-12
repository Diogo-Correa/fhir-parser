import Papa from 'papaparse';
import { InvalidInputDataError } from './errors/InvalidInputDataError';

export function parseCsv(csvString: string): any[] {
	if (typeof csvString !== 'string') {
		throw new InvalidInputDataError('Expected CSV data as a string.');
	}
	try {
		const result = Papa.parse(csvString, {
			header: true, // Assume que a primeira linha é o cabeçalho
			skipEmptyLines: true,
			dynamicTyping: true, // Tenta converter números e booleanos
		});
		if (result.errors.length > 0) {
			console.warn('CSV parsing errors:', result.errors);
			// Decide se quer lançar erro ou continuar com os dados parciais
		}
		return result.data;
	} catch (error: unknown) {
		throw new InvalidInputDataError(`Failed to parse CSV: ${error.message}`);
	}
}

export function parseJson(jsonData: any): any {
	// Se jsonData já for um objeto/array, retorna diretamente
	if (typeof jsonData === 'object' && jsonData !== null) {
		return jsonData;
	}
	// Se for uma string, tenta parsear
	if (typeof jsonData === 'string') {
		try {
			return JSON.parse(jsonData);
		} catch (error: any) {
			throw new InvalidInputDataError(`Failed to parse JSON: ${error.message}`);
		}
	}
	// Se não for nem objeto nem string JSON válida
	throw new InvalidInputDataError(
		'Expected JSON data as an object or a valid JSON string.',
	);
}

export function serializeToCsv(data: any[]): string {
	if (!Array.isArray(data)) {
		throw new Error('Cannot serialize non-array data to CSV');
	}
	try {
		return Papa.unparse(data);
	} catch (error: any) {
		throw new Error(`Failed to serialize data to CSV: ${error.message}`);
	}
}

export function serializeToJson(data: any): string {
	try {
		// O 2 é para indentação (pretty print), pode ser removido para economizar espaço
		return JSON.stringify(data, null, 2);
	} catch (error: any) {
		throw new Error(`Failed to serialize data to JSON: ${error.message}`);
	}
}
