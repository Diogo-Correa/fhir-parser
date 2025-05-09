import {
	format as formatDate,
	isValid as isValidDate,
	parse as parseDate,
} from 'date-fns'; // Importa funções de date-fns
import { getValue } from './getValueByPath';

export function applyTransformation(
	sourceValue: any,
	type: string | null | undefined,
	details: any | null | undefined,
	sourceItem?: any,
): { success: boolean; value?: any; message?: string } {
	// 1. Lida com DEFAULT_VALUE se sourceValue for nulo/undefined
	if (
		(sourceValue === null || sourceValue === undefined) &&
		type?.toUpperCase() === 'DEFAULT_VALUE'
	) {
		// biome-ignore lint/suspicious/noPrototypeBuiltins: <explanation>
		if (details?.hasOwnProperty('value')) {
			// console.log(`[Transformation] Applying DEFAULT_VALUE: ${details.value}`);
			return { success: true, value: details.value };
		}
		console.warn(
			`[Transformation] Missing 'value' in details for DEFAULT_VALUE`,
		);
		return { success: true, value: sourceValue }; // Retorna nulo/undefined original
	}
	// 2. Se não for DEFAULT_VALUE e o valor for nulo/undefined, não aplica outras transformações
	if (sourceValue === null || sourceValue === undefined) {
		return { success: true, value: sourceValue };
	}
	// 3. Se não há tipo, retorna sucesso com valor original
	if (!type) {
		return { success: true, value: sourceValue };
	}

	// 4. Aplica outras transformações
	try {
		let transformedValue: any;
		switch (type.toUpperCase()) {
			case 'FORMAT_DATE': {
				if (!details?.inputFormat || !details.outputFormat)
					return { success: false, message: 'Invalid details for DATE_FORMAT' };
				if (typeof sourceValue !== 'string' || !sourceValue)
					return { success: true, value: sourceValue };
				const parsedDate = parseDate(
					sourceValue,
					details.inputFormat,
					new Date(),
				);
				if (!isValidDate(parsedDate))
					return {
						success: false,
						message: `Failed to parse date '${sourceValue}' with format '${details.inputFormat}'`,
					};
				transformedValue = formatDate(parsedDate, details.outputFormat);
				break;
			}

			case 'STRING_CASE': {
				if (typeof sourceValue !== 'string')
					return { success: true, value: sourceValue };
				const caseType = details?.case?.toLowerCase();
				if (caseType === 'upper') transformedValue = sourceValue.toUpperCase();
				else if (caseType === 'lower')
					transformedValue = sourceValue.toLowerCase();
				else
					return {
						success: false,
						message:
							'Invalid details for STRING_CASE (expected {case: "upper|lower"})',
					};
				break;
			}

			case 'CODE_LOOKUP': {
				if (!details?.map || typeof details.map !== 'object')
					return {
						success: false,
						message: 'Invalid "map" object in details for CODE_LOOKUP',
					};
				const mappedVal = details.map[String(sourceValue)];
				if (mappedVal !== undefined) transformedValue = mappedVal;
				// biome-ignore lint/suspicious/noPrototypeBuiltins: <explanation>
				else if (details.hasOwnProperty('defaultValue'))
					transformedValue = details.defaultValue;
				else
					return {
						success: false,
						message: `Value '${sourceValue}' not found in CODE_LOOKUP map and no defaultValue provided`,
					};
				break;
			}

			case 'CONCATENATE': {
				if (
					!details?.fieldsToConcat ||
					!Array.isArray(details.fieldsToConcat) ||
					!sourceItem
				)
					return {
						success: false,
						message: 'Invalid details or missing sourceItem for CONCATENATE',
					};
				const sep = details.separator ?? '';
				transformedValue = details.fieldsToConcat
					.map((fieldPath: string) =>
						String(getValue(sourceItem, fieldPath) ?? ''),
					)
					.join(sep);
				break;
			}

			// TODO: Adicionar outros cases...

			default:
				return {
					success: false,
					message: `Unsupported transformation type: ${type}`,
				};
		}
		return { success: true, value: transformedValue }; // Retorna sucesso com valor transformado
	} catch (error: any) {
		console.error(
			`[Transformation] Error applying transformation type ${type}: ${error.message}`,
		);
		return {
			success: false,
			message: `Internal error during transformation: ${error.message}`,
		};
	}
}
