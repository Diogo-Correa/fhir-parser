import { describe, expect, it } from 'vitest';
import { getValue } from '../../src/utils/getValueByPath';

describe('getValueByPath', () => {
	const testObject = {
		name: 'Test Patient',
		gender: 'other',
		telecom: [
			{ system: 'phone', value: '555-1234', use: 'home' },
			{ system: 'email', value: 'test@example.com', use: 'work' },
		],
		address: [
			{
				use: 'home',
				city: 'Anytown',
				line: ['123 Main St'],
				postalCode: '12345',
				extension: [
					{
						url: 'http://hl7.org/fhir/StructureDefinition/geolocation',
						valueDecimal: 39.9956,
					},
				],
			},
		],
		contact: [
			{
				relationship: [
					{ coding: [{ system: 'terminology.hl7.org', code: 'N' }] },
				],
				name: { family: 'Smith', given: ['John'] },
			},
			{
				relationship: [
					{ coding: [{ system: 'terminology.hl7.org', code: 'C' }] },
				],
				name: { family: 'Doe', given: ['Jane'] },
			},
		],
		identifier: [
			{ system: 'urn:cns', value: '123456789012345' },
			{ system: 'urn:cpf', value: '98765432100' },
		],
		meta: {
			profile: [
				'http://example.com/StructureDefinition/MyPatient',
				'http://hl7.org/fhir/StructureDefinition/Patient',
			],
		},
	};

	it('should return undefined for null or undefined object', () => {
		expect(getValue(null, 'name')).toBeUndefined();
		expect(getValue(undefined, 'name')).toBeUndefined();
	});

	it('should return undefined for null or empty path', () => {
		expect(getValue(testObject, null)).toBeUndefined();
		expect(getValue(testObject, '')).toBeUndefined();
	});

	it('should return default value if path is not found', () => {
		expect(getValue(testObject, 'nonexistent.path', 'default')).toBe('default');
		expect(getValue(testObject, 'address[2].city', 'N/A')).toBe('N/A');
	});

	it('should retrieve a value from a simple path', () => {
		expect(getValue(testObject, 'name')).toBe('Test Patient');
		expect(getValue(testObject, 'gender')).toBe('other');
	});

	it('should retrieve a value from an array by index', () => {
		expect(getValue(testObject, 'telecom[0].system')).toBe('phone');
		expect(getValue(testObject, 'address[0].city')).toBe('Anytown');
		expect(getValue(testObject, 'meta.profile[1]')).toBe(
			'http://hl7.org/fhir/StructureDefinition/Patient',
		);
	});

	it('should retrieve a value from an array using FHIR-like filter', () => {
		expect(getValue(testObject, "telecom[?system='email'].value")).toBe(
			'test@example.com',
		);
		expect(getValue(testObject, "address[?use='home'].postalCode")).toBe(
			'12345',
		);
	});

	it('should retrieve a value from a deeper FHIR-like filter', () => {
		expect(
			getValue(
				testObject,
				"contact[?relationship.coding.code='N'].name.family",
			),
		).toBe('Smith');
	});

	it('should return undefined if filter does not match', () => {
		expect(
			getValue(testObject, "telecom[?system='fax'].value"),
		).toBeUndefined();
	});

	it('should handle nested arrays and objects', () => {
		expect(getValue(testObject, 'address[0].line[0]')).toBe('123 Main St');
		expect(
			getValue(
				testObject,
				"address[0].extension[?url='http://hl7.org/fhir/StructureDefinition/geolocation'].valueDecimal",
			),
		).toBe(39.9956);
	});

	it('should return the object/array itself if path resolves to it', () => {
		expect(getValue(testObject, 'telecom[0]')).toEqual({
			system: 'phone',
			value: '555-1234',
			use: 'home',
		});
		expect(getValue(testObject, 'address')).toEqual(testObject.address);
	});

	it('should handle paths that target an object when an array is expected by remaining path segments (with filter)', () => {
		const objWithDirectIdentifier = {
			identifier: { system: 'direct', value: 'abc' }, // Not an array
		};
		// This scenario is tricky. Current `getValueByPath` will try to _.get(currentContext, segmentRaw)
		// If segmentRaw is 'identifier' and currentContext.identifier is an object,
		// and next segment is a filter "[?system='direct']", it should ideally work if identifier becomes an array.
		// The current implementation of getDeepFhirPathValue might not directly support this for an object to array promotion with filter.
		// Let's test how it behaves with the current `parsePathSegments` and `getDeepFhirPathValue`.
		// `parsePathSegments` for "identifier[?system='direct'].value" would be ["identifier", "[?system='direct']", "value"]
		// `getDeepFhirPathValue` would get objWithDirectIdentifier.identifier.
		// Then, for "[?system='direct']", it would see it's not an array and `nextContext` becomes undefined.

		// The code snippet provided in `getValueByPath.ts` for handling this case is:
		// if (remainingSegments.length > 0 && remainingSegments[0].startsWith('[?')) {
		// 	const arrayFromObject = _.get(currentContext, segmentRaw);
		// 	const filterSegment = remainingSegments[0];
		// 	const actualRemainingSegments = remainingSegments.slice(1);
		// 	return getDeepFhirPathValue(
		// 		arrayFromObject, // This would be the identifier object, not an array
		// 		[filterSegment, ...actualRemainingSegments],
		// 		defaultValue,
		// 	);
		// }
		// This part implies `arrayFromObject` is passed to `getDeepFhirPathValue`.
		// If `arrayFromObject` (which is `objWithDirectIdentifier.identifier`) is then processed
		// and the segment is `[?system='direct']`, the Array.isArray(currentContext) check will fail.
		// It will then try _.get(currentContext, segmentRaw) which is _.get({system:'direct', value:'abc'}, "[?system='direct']") -> undefined.

		// However, there's another part:
		// else if (
		// 	targetArray.length > 0 &&
		// 	typeof targetArray[0] === 'object' &&
		// 	targetArray[0] !== null
		// ) {
		// 	const propertyOfFirstItem = _.get(targetArray[0], segmentRaw); // segmentRaw here is not the filter
		//  ...
		// }
		// This suggests that if an object is found where an array is expected for filtering,
		// the filter might be applied *as if* the object was the first element of an array.

		// Let's trace based on the provided code:
		// 1. getValue(obj, "identifier[?system='direct'].value")
		// 2. segments = ["identifier", "[?system='direct']", "value"]
		// 3. getDeepFhirPathValue(obj, ["identifier", "[?system='direct']", "value"])
		// 4. segmentRaw = "identifier", remaining = ["[?system='direct']", "value"]
		// 5. nextContext = _.get(obj, "identifier") -> { system: 'direct', value: 'abc' }
		// 6. getDeepFhirPathValue({system:'direct',value:'abc'}, ["[?system='direct']", "value"])
		// 7. segmentRaw = "[?system='direct']", remaining = ["value"]
		// 8. currentContext = {system:'direct',value:'abc'}. Array.isArray is false.
		// 9. The special block:
		//    if (remainingSegments.length > 0 && remainingSegments[0].startsWith('[?'))
		//    This condition is FALSE because segmentRaw IS the filter, not remainingSegments[0].
		//    So it goes to: nextContext = _.get(currentContext, segmentRaw);
		//    -> _.get({system:'direct',value:'abc'}, "[?system='direct']") -> undefined
		// 10. getDeepFhirPathValue(undefined, ["value"]) -> returns defaultValue (undefined)

		// The current implementation of `getValue` seems to not support applying a filter directly to a non-array object.
		// It expects the path *before* the filter to resolve to an array.
		// Let's confirm this understanding with a test.
		expect(
			getValue(objWithDirectIdentifier, "identifier[?system='direct'].value"),
		).toBeUndefined();

		const objWithIdentifierArray = {
			identifier: [{ system: 'direct', value: 'xyz' }],
		};
		expect(
			getValue(objWithIdentifierArray, "identifier[?system='direct'].value"),
		).toBe('xyz');
	});

	it('should correctly retrieve value when path contains choice type like value[x]', () => {
		const choiceObject = {
			effectiveDateTime: '2024-05-25',
			effectivePeriod: { start: '2024-01-01', end: '2024-12-31' },
		};
		expect(getValue(choiceObject, 'effectiveDateTime')).toBe('2024-05-25');
		expect(getValue(choiceObject, 'effectivePeriod.start')).toBe('2024-01-01');
	});

	it('should return undefined for out-of-bounds array index', () => {
		expect(getValue(testObject, 'telecom[5].value')).toBeUndefined();
	});

	it('should access properties of the first item if an array is encountered and segment is not an index or filter', () => {
		expect(getValue(testObject, 'telecom.system')).toBe('phone');
		expect(getValue(testObject, 'address.city')).toBe('Anytown');
		expect(getValue(testObject, 'identifier.system')).toBe('urn:cns');
	});

	it('should correctly handle paths that are direct properties and not needing parsePathSegments heavily', () => {
		expect(getValue(testObject, 'name')).toBe('Test Patient');
		const simpleObj = { a: { b: { c: 1 } } };
		expect(getValue(simpleObj, 'a.b.c')).toBe(1);
	});
});
