/**
 * Analisa uma string de caminho FHIR em segmentos lógicos.
 * Exemplos:
 * - "identifier.use" -> ["identifier", "use"]
 * - "identifier[0].use" -> ["identifier", "0", "use"]
 * - "extension[?url='...'].valueString" -> ["extension", "[?url='...']", "valueString"]
 * - "meta.profile[0]" -> ["meta", "profile", "0"]
 */
export function parsePathSegments(path: string): string[] {
	const segments: string[] = [];
	if (!path || typeof path !== 'string') {
		return segments;
	}

	let currentSegment = '';
	let inBracketDepth = 0;

	for (let i = 0; i < path.length; i++) {
		const char = path[i];

		if (char === '.' && inBracketDepth === 0) {
			if (currentSegment) {
				segments.push(currentSegment);
			}
			currentSegment = '';
		} else if (char === '[') {
			if (inBracketDepth === 0 && currentSegment) {
				segments.push(currentSegment);
				currentSegment = '';
			}
			currentSegment += char;
			inBracketDepth++;
		} else if (char === ']') {
			currentSegment += char;
			inBracketDepth = Math.max(0, inBracketDepth - 1);
			if (inBracketDepth === 0) {
				segments.push(currentSegment);
				currentSegment = '';
				if (i + 1 < path.length && path[i + 1] === '.') {
					i++;
				}
			}
		} else {
			currentSegment += char;
		}
	}

	if (currentSegment) {
		segments.push(currentSegment);
	}

	// Ex: "[0]" se torna "0". Filtros como "[?url='...']" são mantidos.
	return segments
		.map((seg) => {
			if (seg.startsWith('[') && seg.endsWith(']')) {
				const inner = seg.substring(1, seg.length - 1);
				if (/^\d+$/.test(inner)) {
					return inner;
				}
				// Mantém filtros ou outros conteúdos de colchetes intactos (ex: "[?url='...']")
				return seg;
			}
			return seg;
		})
		.filter((s) => s && s.length > 0); // Remove segmentos vazios
}
