import { describe, expect, it } from 'vitest';
import { parsePathSegments } from '../../src/utils/parsePathSegments';

describe('parsePathSegments', () => {
	it('should return an empty array for an empty or invalid path', () => {
		expect(parsePathSegments('')).toEqual([]);
		expect(parsePathSegments(null as any)).toEqual([]);
		expect(parsePathSegments(undefined as any)).toEqual([]);
	});

	it('should parse simple dot-separated paths', () => {
		expect(parsePathSegments('Patient.name.given')).toEqual([
			'Patient',
			'name',
			'given',
		]);
		expect(parsePathSegments('identifier.use')).toEqual(['identifier', 'use']);
	});

	it('should parse paths with array indices', () => {
		expect(parsePathSegments('Patient.name[0].given')).toEqual([
			'Patient',
			'name',
			'0',
			'given',
		]);
		expect(parsePathSegments('identifier[1].system')).toEqual([
			'identifier',
			'1',
			'system',
		]);
		expect(parsePathSegments('telecom[0]')).toEqual(['telecom', '0']);
	});

	it('should parse paths with FHIR search-like filters in brackets', () => {
		expect(
			parsePathSegments(
				"Patient.extension[?url='http://example.com/ext'].valueString",
			),
		).toEqual([
			'Patient',
			'extension',
			"[?url='http://example.com/ext']",
			'valueString',
		]);
		expect(
			parsePathSegments("identifier[?system='urn:oid:1.2.3'].value"),
		).toEqual(['identifier', "[?system='urn:oid:1.2.3']", 'value']);
	});

	it('should handle paths starting or ending with dots or brackets correctly', () => {
		expect(parsePathSegments('.Patient.name')).toEqual(['Patient', 'name']); // Leading dot ignored by split
		expect(parsePathSegments('Patient.name.')).toEqual(['Patient', 'name']); // Trailing dot segment empty, filtered out
		expect(parsePathSegments('name[0]')).toEqual(['name', '0']);
	});

	it('should handle complex nested paths with multiple brackets and filters', () => {
		expect(
			parsePathSegments(
				"Bundle.entry[0].resource.name[0].extension[?url='test'].valueCoding.system",
			),
		).toEqual([
			'Bundle',
			'entry',
			'0',
			'resource',
			'name',
			'0',
			'extension',
			"[?url='test']",
			'valueCoding',
			'system',
		]);
	});

	it('should correctly parse paths where a segment is just an index', () => {
		expect(parsePathSegments('entry[0].resource')).toEqual([
			'entry',
			'0',
			'resource',
		]);
	});

	it('should parse paths with slices correctly', () => {
		expect(parsePathSegments('Patient.identifier:cns.value')).toEqual([
			'Patient',
			'identifier:cns',
			'value',
		]);
		expect(
			parsePathSegments(
				'Observation.component:body-temperature.valueQuantity.value',
			),
		).toEqual([
			'Observation',
			'component:body-temperature',
			'valueQuantity',
			'value',
		]);
	});

	it('should handle paths with slices and indices', () => {
		expect(
			parsePathSegments('Patient.extension:sliceName[0].valueString'),
		).toEqual(['Patient', 'extension:sliceName', '0', 'valueString']);
	});

	it('should return single segment for path without dots or brackets', () => {
		expect(parsePathSegments('resourceType')).toEqual(['resourceType']);
	});
});
