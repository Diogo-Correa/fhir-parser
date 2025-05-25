export function parseFhirStoredValue(
	value: string | null,
	fhirType: string | null,
): any {
	if (value === null || fhirType === null) return undefined;

	const lowerType = fhirType.toLowerCase();
	try {
		switch (lowerType) {
			case 'boolean':
				return value.toLowerCase() === 'true';
			case 'integer':
			case 'positiveint':
			case 'unsignedint':
				return Number.parseInt(value, 10);
			case 'decimal':
				return Number.parseFloat(value);
			// Tipos string já são string
			case 'date':
			case 'datetime':
			case 'instant':
			case 'time':
			case 'string':
			case 'code':
			case 'id':
			case 'markdown':
			case 'uri':
			case 'url':
			case 'canonical':
			case 'oid':
			case 'uuid':
				return value;
			// Tipos complexos armazenados como JSON string
			case 'address':
			case 'annotation':
			case 'attachment':
			case 'codeableconcept':
			case 'coding':
			case 'contactdetail':
			case 'contactpoint':
			case 'contributor':
			case 'datarequirement':
			case 'humanname':
			case 'identifier':
			case 'money':
			case 'parameterdefinition':
			case 'period':
			case 'quantity':
			case 'range':
			case 'ratio':
			case 'reference':
			case 'relatedartifact':
			case 'sampleddata':
			case 'signature':
			case 'timing':
			case 'triggerdefinition':
			case 'usagecontext':
				return JSON.parse(value);
			default:
				console.warn(
					`[parseFhirStoredValue] Unhandled FHIR type '${fhirType}' for value '${value}'. Returning as string.`,
				);
				return value;
		}
	} catch (e) {
		console.error(
			`[parseFhirStoredValue] Error parsing value '${value}' for FHIR type '${fhirType}':`,
			e,
		);
		return undefined; // Erro ao parsear
	}
}
