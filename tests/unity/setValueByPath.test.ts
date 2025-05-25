import { beforeEach, describe, expect, it } from 'vitest';
import { type SdElement, setValue } from '../../src/utils/setValueByPath';

describe('setValueByPath', () => {
	let targetObject: any;
	const allSdElementsSimple: SdElement[] = [
		{ path: 'Patient.name', max: '*' },
		{ path: 'Patient.name.given', max: '*' },
		{ path: 'Patient.name.family', max: '1' },
		{ path: 'Patient.telecom', max: '*' },
		{ path: 'Patient.telecom.system', max: '1' },
		{ path: 'Patient.telecom.value', max: '1' },
		{ path: 'Patient.identifier', max: '*' },
		{ path: 'Patient.identifier.system', max: '1' },
		{ path: 'Patient.identifier.value', max: '1' },
		{ path: 'Patient.address', max: '*' },
		{ path: 'Patient.address.city', max: '1' },
		{ path: 'Patient.contact', max: '*' },
		{ path: 'Patient.contact.name.given', max: '*' },
		{ path: 'Patient.meta.profile', max: '*' },
		{ path: 'Patient.extension', max: '*' },
	];
	const resourceType = 'Patient';

	beforeEach(() => {
		targetObject = {};
	});

	it('should set a simple top-level property', () => {
		setValue(targetObject, 'id', '123', allSdElementsSimple, resourceType);
		expect(targetObject.id).toBe('123');
		setValue(
			targetObject,
			'resourceType',
			'Patient',
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject.resourceType).toBe('Patient');
	});

	it('should set a nested property, creating objects if they dont exist', () => {
		setValue(
			targetObject,
			'name[0].family',
			'Doe',
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject.name[0].family).toBe('Doe');
		setValue(
			targetObject,
			'generalPractitioner[0].reference',
			'Practitioner/abc',
			allSdElementsSimple,
			resourceType,
		);
		// Assuming generalPractitioner is not in allSdElementsSimple, it might default to an object or array.
		// Based on current setValue logic, if not in SdElements, it tries a default list or creates an object.
		// 'generalPractitioner' is not in the default list for auto-array creation.
		expect(targetObject.generalPractitioner[0].reference).toBe(
			'Practitioner/abc',
		);
	});

	it('should set a property in an array at a specific index', () => {
		setValue(
			targetObject,
			'name[0].given[0]',
			'John',
			allSdElementsSimple,
			resourceType,
		);
		setValue(
			targetObject,
			'name[0].given[1]',
			'Jonathan',
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject.name[0].given[0]).toBe('John');
		expect(targetObject.name[0].given[1]).toBe('Jonathan');
		expect(Array.isArray(targetObject.name)).toBe(true);
		expect(Array.isArray(targetObject.name[0].given)).toBe(true);
	});

	it('should create parent objects/arrays as needed for deep paths', () => {
		setValue(
			targetObject,
			'contact[0].name.given[0]',
			'Alice',
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject.contact[0].name.given[0]).toBe('Alice');
		expect(Array.isArray(targetObject.contact)).toBe(true);
		expect(typeof targetObject.contact[0].name).toBe('object');
		expect(Array.isArray(targetObject.contact[0].name.given)).toBe(true);
	});

	it('should correctly handle paths with numeric segments that are not explicit array indices in path string initially', () => {
		// Example: path "name.0.given" - this should be parsed as "name", "0", "given"
		// The setValue logic should treat "0" as an index for the "name" array.
		setValue(
			targetObject,
			'name.0.given.0',
			'TestGiven',
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject.name[0].given[0]).toBe('TestGiven');
	});

	it('should set values in an array using FHIR-like filters, creating item if not exists', () => {
		setValue(
			targetObject,
			"identifier[?system='urn:cns'].value",
			'12345',
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject.identifier[0].system).toBe('urn:cns');
		expect(targetObject.identifier[0].value).toBe('12345');

		setValue(
			targetObject,
			"identifier[?system='urn:cpf'].value",
			'98765',
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject.identifier[1].system).toBe('urn:cpf');
		expect(targetObject.identifier[1].value).toBe('98765');

		// Set another value on existing filtered item
		setValue(
			targetObject,
			"identifier[?system='urn:cns'].use",
			'official',
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject.identifier[0].use).toBe('official');
		expect(targetObject.identifier[0].value).toBe('12345'); // Original value should persist
	});

	it('should create structures as arrays if SdElement.max is > 1 or "*"', () => {
		// 'Patient.name' has max: '*'
		setValue(
			targetObject,
			'name[0].family',
			'Smith',
			allSdElementsSimple,
			resourceType,
		);
		expect(Array.isArray(targetObject.name)).toBe(true);

		// 'Patient.telecom' has max: '*'
		setValue(
			targetObject,
			'telecom[0].value',
			'555-0000',
			allSdElementsSimple,
			resourceType,
		);
		expect(Array.isArray(targetObject.telecom)).toBe(true);

		// 'Patient.name.family' has max: '1', so it should be a direct property if not part of an array itself
		// The path 'name[0].family' implies 'name' is an array. 'family' is a property of name[0].
		// If we were setting 'Patient.name.family', and 'Patient.name' had max '1', 'name' would be an object.
		const singleNameSd: SdElement[] = [
			{ path: 'Patient.name', max: '1' },
			{ path: 'Patient.name.family', max: '1' },
		];
		const singleNameObj: any = {};
		setValue(singleNameObj, 'name.family', 'Solo', singleNameSd, resourceType);
		expect(typeof singleNameObj.name).toBe('object');
		expect(singleNameObj.name.family).toBe('Solo');
	});

	it('should handle paths that do not require array indices but result in array creation due to SdElement', () => {
		// Example: Setting 'Patient.name.given' when 'Patient.name' is an array and 'Patient.name.given' is also an array.
		// Path: name.given - setValue('Patient.name.given', 'Test')
		// Should effectively become name[0].given[0] = 'Test' if name and given are arrays by SD.
		setValue(
			targetObject,
			'name.given',
			'FirstGiven',
			allSdElementsSimple,
			resourceType,
		); // name becomes array, given becomes array
		expect(targetObject.name[0].given[0]).toBe('FirstGiven');

		setValue(
			targetObject,
			'name.given',
			'SecondGivenSameImplicitIndex',
			allSdElementsSimple,
			resourceType,
		); // Should overwrite
		expect(targetObject.name[0].given[0]).toBe('SecondGivenSameImplicitIndex');
		expect(targetObject.name[0].given.length).toBe(1); // Should not create a new given item unless path specifies index

		setValue(
			targetObject,
			'name[0].given[1]',
			'AnotherGiven',
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject.name[0].given[1]).toBe('AnotherGiven');
	});

	it('should correctly set primitive values at the end of a path', () => {
		setValue(targetObject, 'active', true, allSdElementsSimple, resourceType);
		expect(targetObject.active).toBe(true);
		setValue(
			targetObject,
			'deceasedBoolean',
			false,
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject.deceasedBoolean).toBe(false);
		setValue(
			targetObject,
			'birthDate',
			'1990-01-01',
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject.birthDate).toBe('1990-01-01');
	});

	it('should set an entire object if valueToSet is an object', () => {
		const humanName = { family: 'Flinstone', given: ['Fred'] };
		setValue(
			targetObject,
			'name[0]',
			humanName,
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject.name[0]).toEqual(humanName);

		// And then add to it
		setValue(
			targetObject,
			'name[0].use',
			'official',
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject.name[0].use).toBe('official');
		expect(targetObject.name[0].family).toBe('Flinstone');
	});

	it('should handle empty path string by doing nothing gracefully', () => {
		setValue(targetObject, '', 'someValue', allSdElementsSimple, resourceType);
		expect(targetObject).toEqual({});
	});

	it('should handle path that is just the resourceType (no further segments)', () => {
		// This scenario is unlikely for setValue but parsePathSegments would return [resourceType]
		// setDeepFhirPath would then try to set a property named (e.g.) "Patient" on the object.
		// This is fine.
		setValue(
			targetObject,
			resourceType,
			{ detail: 'test' },
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject[resourceType]).toEqual({ detail: 'test' });
	});

	it('should create structure as object if SdElement.max is "1" or not "*"', () => {
		const sdWithSingleMax: SdElement[] = [
			{ path: 'Patient.managingOrganization', max: '1' },
			{ path: 'Patient.managingOrganization.reference', max: '1' },
		];
		setValue(
			targetObject,
			'managingOrganization.reference',
			'Organization/1',
			sdWithSingleMax,
			resourceType,
		);
		expect(typeof targetObject.managingOrganization).toBe('object');
		expect(targetObject.managingOrganization.reference).toBe('Organization/1');
	});

	it('should use default structure (object) if SdElement for property not found and not in common array list', () => {
		setValue(
			targetObject,
			'customField.subField.value',
			'customValue',
			allSdElementsSimple,
			resourceType,
		);
		expect(typeof targetObject.customField).toBe('object');
		expect(typeof targetObject.customField.subField).toBe('object');
		expect(targetObject.customField.subField.value).toBe('customValue');
	});

	it('should use default structure (array) for common FHIR array properties if SdElement not found', () => {
		// 'extension' is in the common list in setValueByPath
		setValue(
			targetObject,
			'extension[0].url',
			'http://example.com/ext',
			[],
			resourceType,
		); // Empty SD
		expect(Array.isArray(targetObject.extension)).toBe(true);
		expect(targetObject.extension[0].url).toBe('http://example.com/ext');

		// 'identifier' is also in the common list
		setValue(targetObject, 'identifier[0].system', 'sys', [], resourceType); // Empty SD
		expect(Array.isArray(targetObject.identifier)).toBe(true);
	});

	it('should pad array with objects when setting a value at an index beyond current length', () => {
		setValue(
			targetObject,
			'telecom[2].value',
			'far-away-phone',
			allSdElementsSimple,
			resourceType,
		);
		expect(Array.isArray(targetObject.telecom)).toBe(true);
		expect(targetObject.telecom.length).toBe(3);
		expect(targetObject.telecom[0]).toEqual({}); // Padded with empty object
		expect(targetObject.telecom[1]).toEqual({}); // Padded with empty object
		expect(targetObject.telecom[2].value).toBe('far-away-phone');
	});

	it('should pad array with nulls when setting a primitive value at an index beyond current length at the end of path', () => {
		// Example: meta.profile[2] = 'value' where profile is string[]
		setValue(
			targetObject,
			'meta.profile[1]',
			'http://profile.two',
			allSdElementsSimple,
			resourceType,
		);
		expect(targetObject.meta.profile.length).toBe(2);
		expect(targetObject.meta.profile[0]).toBeNull(); // Padded with null
		expect(targetObject.meta.profile[1]).toBe('http://profile.two');
	});
});
