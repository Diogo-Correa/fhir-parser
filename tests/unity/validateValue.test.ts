import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validationRegistry } from '../../src/utils/transformation';
import { validateValue } from '../../src/utils/validateValue';

describe('validateValue', () => {
	it('should return null (no error) if validation type is null or undefined', () => {
		expect(validateValue('test', null, {})).toBeNull();
		expect(validateValue(123, undefined, {})).toBeNull();
	});

	describe('REQUIRED', () => {
		it('should return error message if value is null for REQUIRED', () => {
			expect(validateValue(null, 'REQUIRED', {})).toBe(
				'Value is required but was missing or empty.',
			);
		});
		it('should return error message if value is undefined for REQUIRED', () => {
			expect(validateValue(undefined, 'REQUIRED', {})).toBe(
				'Value is required but was missing or empty.',
			);
		});
		it('should return error message if value is an empty string for REQUIRED', () => {
			expect(validateValue('', 'REQUIRED', {})).toBe(
				'Value is required but was missing or empty.',
			);
		});
		it('should return error message if value is a string with only spaces for REQUIRED', () => {
			expect(validateValue('   ', 'REQUIRED', {})).toBe(
				'Value is required but was missing or empty.',
			);
		});
		it('should return null if value is present for REQUIRED (string)', () => {
			expect(validateValue('hello', 'REQUIRED', {})).toBeNull();
		});
		it('should return null if value is present for REQUIRED (number)', () => {
			expect(validateValue(0, 'REQUIRED', {})).toBeNull();
			expect(validateValue(123, 'REQUIRED', {})).toBeNull();
		});
		it('should return null if value is present for REQUIRED (boolean)', () => {
			expect(validateValue(false, 'REQUIRED', {})).toBeNull();
		});
	});

	// REGEX Validation
	describe('REGEX', () => {
		const detailsNumeric = { pattern: '^\\d+$', message: 'Must be numeric.' };
		const detailsNoPattern = {};

		it('should return null if value matches regex', () => {
			expect(validateValue('12345', 'REGEX', detailsNumeric)).toBeNull();
		});
		it('should return custom error message if value does not match regex', () => {
			expect(validateValue('abc', 'REGEX', detailsNumeric)).toBe(
				'Must be numeric.',
			);
		});
		it('should return default error message if value does not match regex and no custom message', () => {
			expect(validateValue('abc', 'REGEX', { pattern: '^\\d+$' })).toBe(
				"Value 'abc' does not match pattern /^\\d+$/.",
			);
		});
		it('should return null if value is null or undefined for REGEX (not its job to check for presence)', () => {
			expect(validateValue(null, 'REGEX', detailsNumeric)).toBeNull();
			expect(validateValue(undefined, 'REGEX', detailsNumeric)).toBeNull();
		});
		it('should return config error if pattern is missing for REGEX', () => {
			expect(validateValue('123', 'REGEX', detailsNoPattern)).toBe(
				'Configuration error: Missing regex pattern.',
			);
		});
		it('should handle invalid regex pattern in details gracefully', () => {
			const result = validateValue('test', 'REGEX', { pattern: '[*+' });
			expect(validateValue('test', 'REGEX', { pattern: '[*+' })).toMatch(
				/Invalid regular expression/,
			);
		});
	});

	describe('MIN_LENGTH', () => {
		const detailsMin5 = { min: 5 };
		it('should return null if value length is equal to min', () => {
			expect(validateValue('hello', 'MIN_LENGTH', detailsMin5)).toBeNull();
		});
		it('should return null if value length is greater than min', () => {
			expect(validateValue('world123', 'MIN_LENGTH', detailsMin5)).toBeNull();
		});
		it('should return error message if value length is less than min', () => {
			expect(validateValue('hi', 'MIN_LENGTH', detailsMin5)).toBe(
				'Value length (2) is less than minimum required (5).',
			);
		});
		it('should return null if value is null or undefined for MIN_LENGTH', () => {
			expect(validateValue(null, 'MIN_LENGTH', detailsMin5)).toBeNull();
			expect(validateValue(undefined, 'MIN_LENGTH', detailsMin5)).toBeNull();
		});
		it('should return config error if min detail is missing or invalid for MIN_LENGTH', () => {
			expect(validateValue('test', 'MIN_LENGTH', {})).toBe(
				'Configuration error: Missing min length.',
			);
			expect(validateValue('test', 'MIN_LENGTH', { min: 'five' })).toBe(
				'Configuration error: Missing min length.',
			);
		});
	});

	describe('MAX_LENGTH', () => {
		const detailsMax5 = { max: 5 };
		it('should return null if value length is equal to max', () => {
			expect(validateValue('hello', 'MAX_LENGTH', detailsMax5)).toBeNull();
		});
		it('should return null if value length is less than max', () => {
			expect(validateValue('hi', 'MAX_LENGTH', detailsMax5)).toBeNull();
		});
		it('should return error message if value length is greater than max', () => {
			expect(validateValue('world123', 'MAX_LENGTH', detailsMax5)).toBe(
				'Value length (8) exceeds maximum allowed (5).',
			);
		});
		it('should return null if value is null or undefined for MAX_LENGTH', () => {
			expect(validateValue(null, 'MAX_LENGTH', detailsMax5)).toBeNull();
			expect(validateValue(undefined, 'MAX_LENGTH', detailsMax5)).toBeNull();
		});
		it('should return config error if max detail is missing or invalid for MAX_LENGTH', () => {
			expect(validateValue('test', 'MAX_LENGTH', {})).toBe(
				'Configuration error: Missing max length.',
			);
			expect(validateValue('test', 'MAX_LENGTH', { max: 'five' })).toBe(
				'Configuration error: Missing max length.',
			);
		});
	});

	describe('VALUESET', () => {
		const detailsValueSet = {
			valueSetUrl: 'http://example.com/vs/my-valueset',
		};
		const consoleWarnSpy = vi.spyOn(console, 'warn');

		beforeEach(() => {
			consoleWarnSpy.mockClear();
		});

		it('should return null for VALUESET (as it is a placeholder)', () => {
			expect(
				validateValue('some-code', 'VALUESET', detailsValueSet),
			).toBeNull();
		});
		it('should log a warning for VALUESET', () => {
			validateValue('some-code', 'VALUESET', detailsValueSet);
			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"[Validation] VALUESET validation for code 'some-code' against 'http://example.com/vs/my-valueset' is NOT YET IMPLEMENTED",
				),
			);
		});
		it('should return null if value is null/undefined for VALUESET', () => {
			expect(validateValue(null, 'VALUESET', detailsValueSet)).toBeNull();
			expect(consoleWarnSpy).not.toHaveBeenCalled();
		});
		it('should return config error if valueSetUrl is missing for VALUESET', () => {
			expect(validateValue('code', 'VALUESET', {})).toBe(
				'Configuration error: Missing ValueSet URL.',
			);
		});
	});

	it('should return config error for unsupported validation type', () => {
		const consoleWarnSpy = vi.spyOn(console, 'warn');
		expect(validateValue('test', 'UNKNOWN_VALIDATION', {})).toBe(
			"Configuration error: Unsupported validation type 'UNKNOWN_VALIDATION'.",
		);
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			'[Validation] Unsupported validation type: UNKNOWN_VALIDATION',
		);
		consoleWarnSpy.mockRestore();
	});

	it('should handle internal errors during validation', () => {
		const originalMinLength = validationRegistry.get('MIN_LENGTH');
		validationRegistry.set('MIN_LENGTH', () => {
			throw new Error('Internal validation boom!');
		});
		const consoleErrorSpy = vi.spyOn(console, 'error');

		const result = validateValue('test', 'MIN_LENGTH', { min: 3 });
		expect(result).toContain(
			'Internal error during validation: Internal validation boom!',
		);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"[Validation] Error during validation type MIN_LENGTH for value 'test': Internal validation boom!",
			),
		);

		if (originalMinLength)
			validationRegistry.set('MIN_LENGTH', originalMinLength);
		consoleErrorSpy.mockRestore();
	});
});
