import {
	format as formatDate,
	isValid as isValidDate,
	parse as parseDate,
} from 'date-fns';
import { getValue } from './getValueByPath';

export interface TransformationContext {
	sourceItem?: any;
}
export type TransformationResult = {
	success: boolean;
	value?: any;
	message?: string;
};
export type TransformationFunction = (
	value: any,
	details: any | null | undefined,
	context?: TransformationContext,
) => TransformationResult;

export type ValidationFunction = (
	value: any,
	details: any | null | undefined,
	context?: TransformationContext,
) => string | null;

export const transformationRegistry = new Map<string, TransformationFunction>();
export const validationRegistry = new Map<string, ValidationFunction>();

// Exemplo: Transformação DATE_FORMAT
const transformDateFormat: TransformationFunction = (value, details) => {
	if (!details?.inputFormat || !details.outputFormat)
		return { success: false, message: 'Invalid details for DATE_FORMAT' };
	if (typeof value !== 'string' || !value)
		return { success: true, value: value };
	try {
		const parsedDate = parseDate(value, details.inputFormat, new Date());
		if (!isValidDate(parsedDate))
			return {
				success: false,
				message: `Failed to parse date '${value}' with format '${details.inputFormat}'`,
			};
		return {
			success: true,
			value: formatDate(parsedDate, details.outputFormat),
		};
	} catch (e: any) {
		return { success: false, message: `Error formatting date: ${e.message}` };
	}
};

// Exemplo: Transformação STRING_CASE
const transformStringCase: TransformationFunction = (value, details) => {
	if (typeof value !== 'string') return { success: true, value: value };
	const caseType = details?.case?.toLowerCase();
	if (caseType === 'upper')
		return { success: true, value: value.toUpperCase() };
	if (caseType === 'lower')
		return { success: true, value: value.toLowerCase() };
	return {
		success: false,
		message: 'Invalid details for STRING_CASE (expected {case: "upper|lower"})',
	};
};

// Exemplo: Transformação DEFAULT_VALUE (Precisa ser tratada um pouco diferente no fluxo principal)
const transformDefaultValue: TransformationFunction = (value, details) => {
	// A lógica principal verificará se value é nulo antes de chamar esta.
	// Esta função é chamada apenas para obter o valor padrão.
	// biome-ignore lint/suspicious/noPrototypeBuiltins: <explanation>
	if (details?.hasOwnProperty('value')) {
		return { success: true, value: details.value };
	}
	return {
		success: false,
		message: "Missing 'value' in details for DEFAULT_VALUE",
	};
};

// Exemplo: Transformação CODE_LOOKUP
const transformCodeLookup: TransformationFunction = (value, details) => {
	if (!details?.map || typeof details.map !== 'object')
		return {
			success: false,
			message: 'Invalid "map" object in details for CODE_LOOKUP',
		};
	const mappedValue = details.map[String(value)];
	if (mappedValue !== undefined) return { success: true, value: mappedValue };
	// biome-ignore lint/suspicious/noPrototypeBuiltins: <explanation>
	if (details.hasOwnProperty('defaultValue'))
		return { success: true, value: details.defaultValue };
	return {
		success: false,
		message: `Value '${value}' not found in CODE_LOOKUP map and no defaultValue provided`,
	};
};

// Exemplo: Transformação CONCATENATE (precisa do contexto)
const transformConcatenate: TransformationFunction = (
	value,
	details,
	context,
) => {
	if (
		!details?.fieldsToConcat ||
		!Array.isArray(details.fieldsToConcat) ||
		!context?.sourceItem
	) {
		return {
			success: false,
			message: 'Invalid details or missing sourceItem for CONCATENATE',
		};
	}
	const separator = details.separator ?? '';
	try {
		const valuesToConcat = details.fieldsToConcat.map((fieldPath: string) => {
			const val = getValue(context.sourceItem, fieldPath); // Usa getValue do utils
			return val !== null && val !== undefined ? String(val) : '';
		});
		return { success: true, value: valuesToConcat.join(separator) };
	} catch (e: any) {
		return {
			success: false,
			message: `Error during CONCATENATE: ${e.message}`,
		};
	}
};

// Exemplo: Validação REQUIRED
const validateRequired: ValidationFunction = (value, details) => {
	if (value === null || value === undefined || String(value).trim() === '') {
		return 'Value is required but was missing or empty.';
	}
	return null;
};

// Exemplo: Validação REGEX
const validateRegex: ValidationFunction = (value, details) => {
	if (!details?.pattern) return 'Configuration error: Missing regex pattern.';
	if (value === null || value === undefined) return null; // Não valida nulos
	try {
		if (!new RegExp(details.pattern).test(String(value))) {
			return (
				details.message ||
				`Value '${value}' does not match pattern /${details.pattern}/.`
			);
		}
		return null;
	} catch (e: any) {
		return `Configuration error: Invalid regex pattern /${details.pattern}/ (${e.message}).`;
	}
};

// Exemplo: Validação MIN_LENGTH
const validateMinLength: ValidationFunction = (value, details) => {
	if (details?.min === undefined || typeof details.min !== 'number')
		return 'Configuration error: Missing/invalid "min" number.';
	if (value === null || value === undefined) return null;
	if (String(value).length < details.min)
		return `Value length (${String(value).length}) is less than minimum required (${details.min}).`;
	return null;
};

// Exemplo: Validação VALUESET (Placeholder)
const validateValueSet: ValidationFunction = (value, details) => {
	if (!details?.valueSetUrl)
		return 'Configuration error: Missing ValueSet URL.';
	if (value === null || value === undefined) return null;
	// TODO: Implementar lógica real de validação (cache ou $validate-code)
	return null;
};

// Transformações
transformationRegistry.set('FORMAT_DATE', transformDateFormat);
transformationRegistry.set('STRING_CASE', transformStringCase);
transformationRegistry.set('DEFAULT_VALUE', transformDefaultValue);
transformationRegistry.set('CODE_LOOKUP', transformCodeLookup);
transformationRegistry.set('CONCATENATE', transformConcatenate);

// Validações
validationRegistry.set('REQUIRED', validateRequired);
validationRegistry.set('REGEX', validateRegex);
validationRegistry.set('MIN_LENGTH', validateMinLength);
validationRegistry.set('VALUESET', validateValueSet);
