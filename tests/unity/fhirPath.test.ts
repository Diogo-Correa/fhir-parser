import { describe, expect, it } from 'vitest';
import { isValidFhirPath } from '../../src/utils/fhirPath';

describe('isValidFhirPath', () => {
	// Suppress console.log/warn during tests for cleaner output
	// vi.spyOn(console, 'log').mockImplementation(() => {});
	// vi.spyOn(console, 'warn').mockImplementation(() => {});
	// vi.spyOn(console, 'debug').mockImplementation(() => {}); // if you use console.debug

	const validPathsBase = new Set([
		'Patient.id',
		'Patient.meta.profile',
		'Patient.name.given',
		'Patient.name.family',
		'Patient.telecom.system',
		'Patient.telecom.value',
		'Patient.identifier.system',
		'Patient.identifier.value',
		'Patient.identifier.type.coding.code', // Deeper path
		'Patient.extension.url', // Path for extension sub-element
		'Patient.extension.valueString', // Path for extension sub-element
		'Observation.status',
		'Observation.code.coding.code',
		'Observation.valueQuantity.value',
		'Observation.component.code.coding.code', // Base for sliced component
		'Observation.component.valueQuantity.value', // Base for sliced component
	]);

	const validPathsWithSlices = new Set([
		...Array.from(validPathsBase),
		'Patient.identifier:cns.system', // Slice definition itself
		'Patient.identifier:cns.value', // Element within a slice
		'Observation.component:vital-signs.code.coding.display', // Sliced element
	]);

	it('should return false for empty or null path', () => {
		expect(isValidFhirPath('', validPathsBase)).toBe(false);
		expect(isValidFhirPath(null as any, validPathsBase)).toBe(false);
	});

	it('should return true for exact match in validPaths', () => {
		expect(isValidFhirPath('Patient.name.given', validPathsBase)).toBe(true);
		expect(isValidFhirPath('Patient.identifier.system', validPathsBase)).toBe(
			true,
		);
	});

	it('should validate paths with array indices by checking simplified path', () => {
		expect(isValidFhirPath('Patient.name[0].given', validPathsBase)).toBe(true);
		expect(isValidFhirPath('Patient.telecom[1].value', validPathsBase)).toBe(
			true,
		);
		expect(isValidFhirPath('Patient.name[0].family', validPathsBase)).toBe(
			true,
		);
	});

	it('should return false if simplified path (no indices) is not in validPaths', () => {
		expect(isValidFhirPath('Patient.nonExistent[0].path', validPathsBase)).toBe(
			false,
		);
	});

	// Tests for slice handling
	it('should validate exact match for a path with a slice name if defined', () => {
		expect(
			isValidFhirPath('Patient.identifier:cns.system', validPathsWithSlices),
		).toBe(true);
	});

	it('should validate path with slice by checking base path + suffix if slice element itself is not defined but base is', () => {
		// Example: 'Patient.identifier:cns.system' should be valid if 'Patient.identifier.system' is in validPaths
		// (and Patient.identifier:cns might exist or just Patient.identifier)
		const pathsWithoutSpecificSliceElement = new Set([
			'Patient.identifier.system', // Base + suffix
			'Patient.identifier.value',
			'Patient.identifier', // Base of slice
		]);
		expect(
			isValidFhirPath(
				'Patient.identifier:cns.system',
				pathsWithoutSpecificSliceElement,
			),
		).toBe(true);
		expect(
			isValidFhirPath(
				'Patient.identifier:cns.value',
				pathsWithoutSpecificSliceElement,
			),
		).toBe(true);
	});

	it('should validate path ending with just slice name (no suffix) by checking the base path', () => {
		// Example: 'Patient.identifier:cns' should be valid if 'Patient.identifier' is in validPaths
		const pathsWithBaseForSlice = new Set(['Patient.identifier']);
		expect(
			isValidFhirPath('Patient.identifier:cns', pathsWithBaseForSlice),
		).toBe(true);
		expect(
			isValidFhirPath('Patient.identifier:otherSlice', pathsWithBaseForSlice),
		).toBe(true);
	});

	it('should correctly handle paths with slices and indices by simplifying both', () => {
		// 'Patient.identifier:cns[0].value' valid if 'Patient.identifier.value' is valid (after simplifying slice and index)
		const pathsForSliceAndIndex = new Set([
			'Patient.identifier.value',
			'Patient.identifier',
		]);
		expect(
			isValidFhirPath('Patient.identifier:cns[0].value', pathsForSliceAndIndex),
		).toBe(true);

		// 'Observation.component:vital-signs[0].code.coding.display' valid if 'Observation.component.code.coding.display' valid
		expect(
			isValidFhirPath(
				'Observation.component:vital-signs[0].code.coding.display',
				validPathsWithSlices,
			),
		).toBe(true);
	});

	it('should return false for paths not matching any validation criteria', () => {
		expect(isValidFhirPath('Patient.address.street', validPathsBase)).toBe(
			false,
		);
		expect(isValidFhirPath('Patient.name[0].nonExistent', validPathsBase)).toBe(
			false,
		);
		expect(
			isValidFhirPath('Patient.identifier:nonSlice.system', validPathsBase),
		).toBe(false); // Slice not defined and base+suffix also not directly
	});

	it('should correctly validate complex paths with multiple nestings and slices/indices', () => {
		const complexValidPaths = new Set([
			'Bundle.entry.resource.Patient.name.given',
			'Bundle.entry.resource.Patient.identifier.value',
			'Bundle.entry.resource.Observation.component.valueQuantity.value',
		]);
		expect(
			isValidFhirPath(
				'Bundle.entry[0].resource.Patient.name[0].given',
				complexValidPaths,
			),
		).toBe(true);
		expect(
			isValidFhirPath(
				'Bundle.entry[0].resource.Patient.identifier:idSistema[0].value',
				complexValidPaths,
			),
		).toBe(true); // Check base + suffix
		expect(
			isValidFhirPath(
				'Bundle.entry[0].resource.Observation.component:blood-pressure.valueQuantity.value',
				complexValidPaths,
			),
		).toBe(true);
	});

	it('should return true if a slice base path is present, even if the specific slice element path is not', () => {
		// e.g., path = 'Patient.identifier:cns.system', validPaths = {'Patient.identifier'}
		// This is attempt 3 in isValidFhirPath, then the basePathOnly check.
		const validPaths = new Set<string>(['Patient.identifier']);
		expect(isValidFhirPath('Patient.identifier:cns.system', validPaths)).toBe(
			true,
		);
	});
});
