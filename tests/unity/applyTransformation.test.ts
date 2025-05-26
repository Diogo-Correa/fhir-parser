import { describe, expect, it, vi } from 'vitest';
import { applyTransformation } from '../../src/utils/applyTransformation';
import { transformationRegistry } from '../../src/utils/transformation';

vi.mock('./getValueByPath', () => ({
	getValue: vi.fn((sourceItem, path) => {
		if (sourceItem && path === 'firstName') return sourceItem.firstName;
		if (sourceItem && path === 'lastName') return sourceItem.lastName;
		if (sourceItem && path === 'middleName') return sourceItem.middleName;
		if (sourceItem && path === 'nonExistent') return undefined;
		return `mockValueFor_${path}`;
	}),
}));

describe('applyTransformation', () => {
	it('should return original value if type is null or undefined', () => {
		expect(applyTransformation('test', null, {})).toEqual({
			success: true,
			value: 'test',
		});
		expect(applyTransformation(123, undefined, {})).toEqual({
			success: true,
			value: 123,
		});
	});

	it('should return original value if sourceValue is null/undefined AND type is NOT DEFAULT_VALUE', () => {
		expect(applyTransformation(null, 'STRING_CASE', { case: 'upper' })).toEqual(
			{ success: true, value: null },
		);
		expect(applyTransformation(undefined, 'FORMAT_DATE', {})).toEqual({
			success: true,
			value: undefined,
		});
	});

	describe('DEFAULT_VALUE', () => {
		it('should apply DEFAULT_VALUE if sourceValue is null', () => {
			const result = applyTransformation(null, 'DEFAULT_VALUE', {
				value: 'defaultValue',
			});
			expect(result).toEqual({ success: true, value: 'defaultValue' });
		});

		it('should apply DEFAULT_VALUE if sourceValue is undefined', () => {
			const result = applyTransformation(undefined, 'DEFAULT_VALUE', {
				value: 0,
			});
			expect(result).toEqual({ success: true, value: 0 });
		});

		it('should return original value (null/undefined) if details are missing for DEFAULT_VALUE', () => {
			const result = applyTransformation(null, 'DEFAULT_VALUE', {});
			expect(result).toEqual({ success: true, value: null });
		});

		it('should not apply DEFAULT_VALUE if sourceValue is present', () => {
			const result = applyTransformation('hasValue', 'DEFAULT_VALUE', {
				value: 'defaultValue',
			});
			expect(result).toEqual({ success: true, value: 'hasValue' });
		});
	});

	describe('FORMAT_DATE', () => {
		it('should format date correctly', () => {
			const result = applyTransformation('2023-01-15', 'FORMAT_DATE', {
				inputFormat: 'yyyy-MM-dd',
				outputFormat: 'dd/MM/yyyy',
			});
			expect(result).toEqual({ success: true, value: '15/01/2023' });
		});

		it('should return original value if not a string for FORMAT_DATE', () => {
			const result = applyTransformation(12345, 'FORMAT_DATE', {
				inputFormat: 'T',
				outputFormat: 'dd/MM/yyyy',
			});
			expect(result).toEqual({ success: true, value: 12345 });
		});

		it('should fail if date parsing fails for FORMAT_DATE', () => {
			const result = applyTransformation('invalid-date', 'FORMAT_DATE', {
				inputFormat: 'yyyy-MM-dd',
				outputFormat: 'dd/MM/yyyy',
			});
			expect(result.success).toBe(false);
			expect(result.message).toContain("Failed to parse date 'invalid-date'");
		});

		it('should fail if details are invalid for FORMAT_DATE', () => {
			const result = applyTransformation('2023-01-15', 'FORMAT_DATE', {
				inputFormat: 'yyyy-MM-dd',
			});
			expect(result.success).toBe(false);
			expect(result.message).toBe('Invalid details for DATE_FORMAT');
		});
	});

	describe('STRING_CASE', () => {
		it('should convert to uppercase', () => {
			const result = applyTransformation('hello', 'STRING_CASE', {
				case: 'upper',
			});
			expect(result).toEqual({ success: true, value: 'HELLO' });
		});

		it('should convert to lowercase', () => {
			const result = applyTransformation('WORLD', 'STRING_CASE', {
				case: 'lower',
			});
			expect(result).toEqual({ success: true, value: 'world' });
		});

		it('should return original value if not a string for STRING_CASE', () => {
			const result = applyTransformation(123, 'STRING_CASE', { case: 'upper' });
			expect(result).toEqual({ success: true, value: 123 });
		});

		it('should fail if case detail is invalid for STRING_CASE', () => {
			const result = applyTransformation('test', 'STRING_CASE', {
				case: 'unknown',
			});
			expect(result.success).toBe(false);
			expect(result.message).toContain('Invalid details for STRING_CASE');
		});
	});

	describe('CODE_LOOKUP', () => {
		const details = {
			map: { M: 'Male', F: 'Female' },
			defaultValue: 'Unknown',
		};
		it('should lookup code successfully', () => {
			const result = applyTransformation('M', 'CODE_LOOKUP', details);
			expect(result).toEqual({ success: true, value: 'Male' });
		});

		it('should use defaultValue if code not found', () => {
			const result = applyTransformation('O', 'CODE_LOOKUP', details);
			expect(result).toEqual({ success: true, value: 'Unknown' });
		});

		it('should fail if code not found and no defaultValue', () => {
			const result = applyTransformation('X', 'CODE_LOOKUP', {
				map: { A: 'Alpha' },
			});
			expect(result.success).toBe(false);
			expect(result.message).toContain(
				"Value 'X' not found in CODE_LOOKUP map",
			);
		});

		it('should fail if map detail is invalid for CODE_LOOKUP', () => {
			const result = applyTransformation('M', 'CODE_LOOKUP', {
				map: 'not-an-object',
			});
			expect(result.success).toBe(false);
			expect(result.message).toContain(
				'Invalid "map" object in details for CODE_LOOKUP',
			);
		});
	});

	describe('CONCATENATE', () => {
		const sourceItem = { firstName: 'John', lastName: 'Doe', middleName: 'M.' };
		const sourceItemNoMiddle = { firstName: 'Jane', lastName: 'Doe' };

		it('should concatenate fields with default separator', () => {
			const result = applyTransformation(
				null,
				'CONCATENATE',
				{ fieldsToConcat: ['firstName', 'lastName'] },
				sourceItem,
			);
			expect(result).toEqual({ success: true, value: 'JohnDoe' });
		});

		it('should concatenate fields with specified separator', () => {
			const result = applyTransformation(
				null,
				'CONCATENATE',
				{ fieldsToConcat: ['firstName', 'lastName'], separator: ' ' },
				sourceItem,
			);
			expect(result).toEqual({ success: true, value: 'John Doe' });
		});

		it('should handle missing fields in concatenation by using empty string', () => {
			const result = applyTransformation(
				null,
				'CONCATENATE',
				{
					fieldsToConcat: ['firstName', 'middleName', 'lastName'],
					separator: ' ',
				},
				sourceItemNoMiddle,
			);
			expect(result).toEqual({ success: true, value: 'Jane  Doe' });
		});

		it('should concatenate fields including one that is null or undefined in source', () => {
			const sourceWithNull = {
				firstName: 'Only',
				middleName: null,
				lastName: 'Name',
			};
			const result = applyTransformation(
				null,
				'CONCATENATE',
				{
					fieldsToConcat: ['firstName', 'middleName', 'lastName'],
					separator: ' ',
				},
				sourceWithNull,
			);
			expect(result).toEqual({ success: true, value: 'Only  Name' });
		});

		it('should fail if details are invalid for CONCATENATE (missing fieldsToConcat)', () => {
			const result = applyTransformation(
				null,
				'CONCATENATE',
				{ separator: ' ' },
				sourceItem,
			);
			expect(result.success).toBe(false);
			expect(result.message).toContain(
				'Invalid details or missing sourceItem for CONCATENATE',
			);
		});

		it('should fail if sourceItem is missing for CONCATENATE', () => {
			const result = applyTransformation(null, 'CONCATENATE', {
				fieldsToConcat: ['firstName', 'lastName'],
			});
			expect(result.success).toBe(false);
			expect(result.message).toContain(
				'Invalid details or missing sourceItem for CONCATENATE',
			);
		});
	});

	it('should return error for unsupported transformation type', () => {
		const result = applyTransformation('test', 'UNSUPPORTED_TYPE', {});
		expect(result.success).toBe(false);
		expect(result.message).toBe(
			'Unsupported transformation type: UNSUPPORTED_TYPE',
		);
	});

	it('should handle internal errors during transformation', () => {
		const originalFormatDate = transformationRegistry.get('FORMAT_DATE');
		transformationRegistry.set('FORMAT_DATE', () => {
			throw new Error('Internal boom!');
		});

		const result = applyTransformation('2023-01-01', 'FORMAT_DATE', {
			inputFormat: 'yyyy-MM-dd',
			outputFormat: 'dd/MM/yyyy',
		});
		expect(result.success).toBe(false);
		expect(result.message).toContain(
			'Internal error during transformation: Internal boom!',
		);

		// Restore
		if (originalFormatDate)
			transformationRegistry.set('FORMAT_DATE', originalFormatDate);
	});
});
