import { Transform } from 'node:stream';
import Papa from 'papaparse';
import { parser } from 'stream-json';
import { streamValues } from 'stream-json/streamers/StreamValues';
import { InvalidInputDataError } from './transform.service';

export function createCsvParserStream(): Transform {
	return Papa.parse(Papa.NODE_STREAM_INPUT, {
		header: true,
		skipEmptyLines: true,
		dynamicTyping: true,
	});
}

export function createJsonParserStream(): Transform {
	const jsonParser = parser({ jsonStreaming: true });
	const valueStream = streamValues();
	jsonParser.pipe(valueStream);

	const objectExtractor = new Transform({
		objectMode: true,
		transform({ key, value }, encoding, callback) {
			this.push(value);
			callback();
		},
	});
	valueStream.pipe(objectExtractor);

	const combinedStream = new Transform({
		writableObjectMode: false,
		readableObjectMode: true,
		transform(chunk, encoding, callback) {
			if (!jsonParser.write(chunk, encoding)) {
				jsonParser.once('drain', callback);
			} else {
				process.nextTick(callback);
			}
		},
		flush(callback) {
			jsonParser.end(() => callback());
		},
	});

	objectExtractor.on('data', (data) => {
		if (!combinedStream.push(data)) {
			objectExtractor.pause();
			combinedStream.once('drain', () => objectExtractor.resume());
		}
	});
	objectExtractor.on('end', () => combinedStream.push(null));
	objectExtractor.on('error', (err) => combinedStream.emit('error', err));
	jsonParser.on('error', (err) => combinedStream.emit('error', err));

	return combinedStream;
}

// --- Stream Stringifiers ---

export function createNdjsonStringifyStream(): Transform {
	return new Transform({
		objectMode: true,
		writableHighWaterMark: 16, // Opcional: ajustar buffer
		readableHighWaterMark: 16, // Opcional: ajustar buffer
		transform(chunk, encoding, callback) {
			try {
				this.push(`${JSON.stringify(chunk)}\n`);
				callback();
			} catch (error: any) {
				callback(
					new Error(`Failed to stringify object to NDJSON: ${error.message}`),
				);
			}
		},
	});
}

export function createCsvStringifyStream(): Transform {
	let headerWritten = false;
	let papaUnparser: ((row: object) => string) | null = null;

	return new Transform({
		objectMode: true,
		writableHighWaterMark: 16,
		readableHighWaterMark: 16,
		transform(chunk, encoding, callback) {
			try {
				if (!headerWritten) {
					// Força que o chunk seja um objeto plano para gerar o header
					const flatChunk = flattenObject(chunk);
					const csvString = Papa.unparse([flatChunk]);
					const lines = csvString.split('\n');
					this.push(`${lines[0]}\n`); // Header
					// Prepara o unparser para as próximas linhas (sem header e com as colunas do header)
					const headers = Papa.parse(lines[0], { header: false })
						.data[0] as string[];
					papaUnparser = (row: object) =>
						Papa.unparse([flattenObject(row)], {
							header: false,
							columns: headers,
						});
					// Processa a primeira linha de dados (se existir)
					if (lines[1] && lines[1].trim() !== '') {
						this.push(`${lines[1].trim()}\n`);
					}
					headerWritten = true;
				} else if (papaUnparser) {
					const csvRow = papaUnparser(chunk).trim();
					if (csvRow) {
						this.push(`${csvRow}\n`);
					}
				} else {
					return callback(
						new Error('CSV stringifier not properly initialized.'),
					);
				}
				callback();
			} catch (error: any) {
				callback(
					new Error(`Failed to stringify object to CSV: ${error.message}`),
				);
			}
		},
		flush(callback) {
			callback();
		},
	});
}

// Helper para garantir que objetos complexos sejam achatados para CSV
// (Pode precisar de mais lógica dependendo da complexidade dos objetos FROM_FHIR)
function flattenObject(obj: any, prefix = '', res: any = {}): any {
	for (const key in obj) {
		const newKey = prefix ? `${prefix}.${key}` : key;
		if (
			typeof obj[key] === 'object' &&
			obj[key] !== null &&
			!Array.isArray(obj[key])
		) {
			flattenObject(obj[key], newKey, res);
		} else if (Array.isArray(obj[key])) {
			// Converte array para string simples ou ignora (decisão de projeto)
			res[newKey] = obj[key].join(';'); // Exemplo: junta com ';'
		} else {
			res[newKey] = obj[key];
		}
	}
	return res;
}

// Função não-stream (mantida para compatibilidade interna ou testes)
export function parseJson(jsonData: any): any {
	if (typeof jsonData === 'object' && jsonData !== null) {
		return jsonData;
	}
	if (typeof jsonData === 'string') {
		try {
			return JSON.parse(jsonData);
		} catch (error: any) {
			throw new InvalidInputDataError(`Failed to parse JSON: ${error.message}`);
		}
	}
	throw new InvalidInputDataError(
		'Expected JSON data as an object or a valid JSON string.',
	);
}

export function serializeToJson(data: any): string {
	try {
		return JSON.stringify(data, null, 2); // Pretty print
	} catch (error: any) {
		// Não deve acontecer com objetos válidos, mas por segurança
		console.error('Error serializing data to JSON:', error);
		throw new Error(`Failed to serialize data to JSON: ${error.message}`);
	}
}
