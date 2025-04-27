import { type Duplex, Transform } from 'node:stream';
import Papa from 'papaparse';
import { parser } from 'stream-json';
import { streamValues } from 'stream-json/streamers/StreamValues';
import { InvalidInputDataError } from './errors/InvalidInputDataError';

export function createCsvParserStream(): Duplex {
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
		transform({ key, value }, _, callback) {
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
		writableHighWaterMark: 16,
		readableHighWaterMark: 16,
		transform(chunk, encoding, callback) {
			try {
				// Não filtra mais, apenas stringifica o que vier
				this.push(`${JSON.stringify(chunk)}\n`);
				callback();
			} catch (error: any) {
				// Erro ao stringificar (raro, mas possível com refs circulares não tratadas)
				console.error('[NdjsonStringify] Error stringifying chunk:', error);
				// Tenta stringificar um erro substituto
				try {
					this.push(
						`${JSON.stringify({
							_isTransformError: true,
							errors: [
								{
									message: `Failed to stringify original object: ${error.message}`,
								},
							],
							originalItem: '[[Unstringifiable Object]]',
						})}\n`,
					);
					callback();
				} catch {
					callback(error); // Falha total ao stringificar
				}
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
			// Verifica se é um objeto de erro
			if (chunk && chunk._isTransformError === true) {
				console.error(
					'[CsvStringify] Skipping item due to transformation errors:',
					JSON.stringify(chunk.errors),
				);
				return callback(); // Descarta o erro e continua
			}

			// Processa o objeto de dados normalmente
			try {
				const dataObject = chunk; // Assume que chunk é o objeto de dados
				if (!dataObject || typeof dataObject !== 'object') {
					console.warn('[CsvStringify] Skipping non-object item:', dataObject);
					return callback(); // Descarta item inválido
				}

				if (!headerWritten) {
					const flatChunk = flattenObject(dataObject); // Achata para CSV
					const csvString = Papa.unparse([flatChunk], { header: true }); // Força header na primeira vez
					const lines = csvString.split('\n');
					this.push(`${lines[0]}\n`);
					const headers = Papa.parse(lines[0], { header: false })
						.data[0] as string[];
					papaUnparser = (row: object) =>
						Papa.unparse([flattenObject(row)], {
							header: false,
							columns: headers,
						});
					if (lines[1] && lines[1].trim() !== '') {
						this.push(`${lines[1].trim()}\n`);
					}
					headerWritten = true;
				} else if (papaUnparser) {
					const csvRow = papaUnparser(dataObject).trim();
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
				console.error(
					'[CsvStringify] Error processing item for CSV:',
					error,
					'Item:',
					JSON.stringify(chunk).substring(0, 200),
				);
				// Não propaga o erro para não parar o stream, apenas loga
				callback();
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
