export function validateValue(
	value: any,
	type: string | null | undefined,
	details: any | null | undefined,
): string | null {
	if (!type) return null; // Sem validação

	try {
		switch (type.toUpperCase()) {
			case 'REQUIRED':
				if (
					value === null ||
					value === undefined ||
					String(value).trim() === ''
				) {
					return 'Value is required but was missing or empty.';
				}
				return null; // Válido

			case 'REGEX':
				if (!details?.pattern) {
					console.warn(`[Validation] Missing 'pattern' in details for REGEX`);
					return 'Configuration error: Missing regex pattern.';
				}
				if (value === null || value === undefined) return null; // Não valida nulos (use REQUIRED para isso)
				if (!new RegExp(details.pattern).test(String(value))) {
					return (
						details.message ||
						`Value '${value}' does not match pattern /${details.pattern}/.`
					);
				}
				return null; // Válido

			case 'MIN_LENGTH':
				if (!details || typeof details.min !== 'number') {
					console.warn(
						`[Validation] Missing/invalid 'min' number in details for MIN_LENGTH`,
					);
					return 'Configuration error: Missing min length.';
				}
				if (value === null || value === undefined) return null;
				if (String(value).length < details.min) {
					return `Value length (${String(value).length}) is less than minimum required (${details.min}).`;
				}
				return null; // Válido

			case 'MAX_LENGTH':
				if (!details || typeof details.max !== 'number') {
					console.warn(
						`[Validation] Missing/invalid 'max' number in details for MAX_LENGTH`,
					);
					return 'Configuration error: Missing max length.';
				}
				if (value === null || value === undefined) return null;
				if (String(value).length > details.max) {
					return `Value length (${String(value).length}) exceeds maximum allowed (${details.max}).`;
				}
				return null; // Válido

			case 'VALUESET': {
				if (!details?.valueSetUrl) {
					console.warn(
						`[Validation] Missing 'valueSetUrl' in details for VALUESET`,
					);
					return 'Configuration error: Missing ValueSet URL.';
				}
				if (value === null || value === undefined) return null; // Não valida nulos

				// --- LÓGICA DE VALIDAÇÃO DE VALUESET (Placeholder) ---
				// TODO: Implementar busca no cache local ou chamada à API $validate-code
				const isValidCode = true; // <<-- SUBSTITUIR PELA LÓGICA REAL
				const valueSetUrl = details.valueSetUrl;
				console.warn(
					`[Validation] VALUESET validation for code '${value}' against '${valueSetUrl}' is NOT YET IMPLEMENTED. Assuming valid for now.`,
				);
				if (!isValidCode) {
					// A força ('required', 'extensible', etc.) poderia influenciar se isso é um erro hard ou warning
					return `Value '${value}' is not valid according to ValueSet '${valueSetUrl}'.`;
				}
				// --- Fim do Placeholder ---
				return null; // Válido (no placeholder)
			}

			default:
				console.warn(`[Validation] Unsupported validation type: ${type}`);
				return `Configuration error: Unsupported validation type '${type}'.`; // Erro de configuração
		}
	} catch (error: any) {
		console.error(
			`[Validation] Error during validation type ${type} for value '${value}': ${error.message}`,
		);
		return `Internal error during validation: ${error.message}`;
	}
}
