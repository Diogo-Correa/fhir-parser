/**
 * Verifica se um determinado caminho FHIR (do mapeamento) é considerado válido
 * em relação a um conjunto de caminhos definidos em uma StructureDefinition.
 *
 * @param path O caminho FHIR a ser validado (ex: 'Patient.name[0].given', 'Patient.identifier:cns.system').
 * @param validPaths Um Set contendo todos os caminhos de elemento definidos na StructureDefinition processada (ex: 'Patient.name.given', 'Patient.identifier:cns.system').
 * @returns true se o caminho for considerado válido, false caso contrário.
 */
export function isValidFhirPath(
	path: string,
	validPaths: Set<string>,
): boolean {
	console.log(`Validating path: ${path}`);
	console.log(`Valid paths: ${Array.from(validPaths).join(', ')}`);

	if (!path) {
		// Caminho vazio ou nulo não é válido
		return false;
	}

	// 1. Tentativa: Verifica o caminho exato
	// Ex: 'Patient.identifier:cns.system' existe exatamente em validPaths
	if (validPaths.has(path)) {
		return true;
	}

	// 2. Tentativa: Simplifica removendo índices [...] e verifica novamente
	// Ex: valida 'Patient.name[0].given' verificando se 'Patient.name.given' existe
	const simplifiedPath = path.replace(/\[.*?\]/g, '');
	if (path !== simplifiedPath && validPaths.has(simplifiedPath)) {
		// console.debug(`Path '${path}' validated using simplified path '${simplifiedPath}'`);
		return true;
	}

	// 3. Tentativa: Simplifica removendo slices ':slicename' e verifica o caminho base + sufixo
	// Ex: valida 'Patient.identifier:cns.system' verificando se 'Patient.identifier.system' existe
	// Isso permite mapear para um elemento dentro de uma slice se o elemento base correspondente for definido.
	// Regex: ^(.*?)   :   ([^.]+)   \.   (.*)$
	//       Grupo 1   :   Grupo 2   .   Grupo 3
	//       Base Path : Slice Name . Suffix Path
	const sliceMatch = simplifiedPath.match(/^(.*?):([^.]+)\.(.*)$/);
	if (sliceMatch) {
		// Recria o caminho base + sufixo (ex: Patient.identifier.system)
		const basePathWithSuffix = `${sliceMatch[1]}.${sliceMatch[3]}`;
		if (validPaths.has(basePathWithSuffix)) {
			// console.debug(`Path '${path}' validated using base path '${basePathWithSuffix}' after removing slice '${sliceMatch[2]}'`);
			return true;
		}
		// Tenta também validar apenas o elemento base da slice (ex: Patient.identifier)
		// Isso pode ser útil se a própria slice for uma restrição e o elemento base for permitido.
		const basePathOnly = sliceMatch[1];
		if (validPaths.has(basePathOnly)) {
			// console.debug(`Path '${path}' validated using base element path '${basePathOnly}' after removing slice '${sliceMatch[2]}'`);
			return true;
		}
	}
	// Tentativa 4: Se o path termina com :sliceName (sem sufixo), valida o path base
	// Ex: valida Patient.identifier:cns verificando se Patient.identifier existe
	const sliceOnlyMatch = simplifiedPath.match(/^(.*?):([^.]+)$/);
	if (sliceOnlyMatch) {
		const basePathOnly = sliceOnlyMatch[1];
		if (validPaths.has(basePathOnly)) {
			// console.debug(`Path '${path}' validated using base element path '${basePathOnly}' after removing slice '${sliceOnlyMatch[2]}'`);
			return true;
		}
	}

	// Se nenhuma das validações passou, o caminho é considerado inválido
	// console.warn(`Path validation failed for: '${path}' (Simplified: '${simplifiedPath}')`);
	return false;
}
