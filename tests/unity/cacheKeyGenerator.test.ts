import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateCacheKey } from '../../src/utils/cacheKeyGenerator';

describe('generateCacheKey', () => {
	const prefix = 'testPrefix';

	it('should generate different keys for different mappingConfigName', () => {
		const params1 = { mappingConfigName: 'config1' };
		const params2 = { mappingConfigName: 'config2' };
		const key1 = generateCacheKey(prefix, params1);
		const key2 = generateCacheKey(prefix, params2);
		expect(key1).not.toBe(key2);
		expect(key1.startsWith(prefix)).toBe(true);
	});

	it('should generate different keys for different sendToFhirServer values', () => {
		const params1 = { mappingConfigName: 'config', sendToFhirServer: true };
		const params2 = { mappingConfigName: 'config', sendToFhirServer: false };
		const key1 = generateCacheKey(prefix, params1);
		const key2 = generateCacheKey(prefix, params2);
		expect(key1).not.toBe(key2);
	});

	it('should treat string "true" and boolean true for sendToFhirServer as the same', () => {
		const params1 = {
			mappingConfigName: 'config',
			sendToFhirServer: 'true' as any,
		}; // Cast for test
		const params2 = { mappingConfigName: 'config', sendToFhirServer: true };
		const key1 = generateCacheKey(prefix, params1);
		const key2 = generateCacheKey(prefix, params2);
		expect(key1).toBe(key2);
	});

	it('should generate different keys for different fhirServerUrlOverride values', () => {
		const params1 = {
			mappingConfigName: 'config',
			fhirServerUrlOverride: 'http://server1.com',
		};
		const params2 = {
			mappingConfigName: 'config',
			fhirServerUrlOverride: 'http://server2.com',
		};
		const key1 = generateCacheKey(prefix, params1);
		const key2 = generateCacheKey(prefix, params2);
		expect(key1).not.toBe(key2);
	});

	it('should treat null and undefined fhirServerUrlOverride as the same as not providing it (effectively)', () => {
		const params1 = {
			mappingConfigName: 'config',
			fhirServerUrlOverride: null,
		};
		const params2 = {
			mappingConfigName: 'config',
			fhirServerUrlOverride: undefined,
		};
		const params3 = { mappingConfigName: 'config' }; // Not provided
		const key1 = generateCacheKey(prefix, params1);
		const key2 = generateCacheKey(prefix, params2);
		const key3 = generateCacheKey(prefix, params3);
		expect(key1).toBe(key2);
		expect(key1).toBe(key3); // Because null/undefined fhirServerUrlOverride results in `fhirServerUrlOverride: null` in relevantParams
	});

	it('should generate different keys for different inputDataHash values', () => {
		const params1 = { mappingConfigName: 'config', inputDataHash: 'hash1' };
		const params2 = { mappingConfigName: 'config', inputDataHash: 'hash2' };
		const key1 = generateCacheKey(prefix, params1);
		const key2 = generateCacheKey(prefix, params2);
		expect(key1).not.toBe(key2);
	});

	it('should generate different keys for different fhirQueryPath values', () => {
		const params1 = {
			mappingConfigName: 'config',
			fhirQueryPath: '/Patient?name=Test',
		};
		const params2 = {
			mappingConfigName: 'config',
			fhirQueryPath: '/Observation?code=123',
		};
		const key1 = generateCacheKey(prefix, params1);
		const key2 = generateCacheKey(prefix, params2);
		expect(key1).not.toBe(key2);
	});

	it('should generate the same key for the same parameters regardless of order', () => {
		// generateCacheKey sorts keys of relevantParams before stringifying
		const params1 = {
			mappingConfigName: 'orderTest',
			sendToFhirServer: true,
			fhirServerUrlOverride: 'http://abc.com',
			inputDataHash: 'datahash123',
		};
		const params2 = {
			// Different order
			inputDataHash: 'datahash123',
			fhirServerUrlOverride: 'http://abc.com',
			sendToFhirServer: true,
			mappingConfigName: 'orderTest',
		};
		const key1 = generateCacheKey(prefix, params1);
		const key2 = generateCacheKey(prefix, params2);
		expect(key1).toBe(key2);
	});

	it('should include only relevant parameters in the hash', () => {
		const paramsWithExtra = {
			mappingConfigName: 'relevantTest',
			sendToFhirServer: false,
			extraParam: 'shouldBeIgnored', // This is not in relevantParams logic
		} as any;
		const paramsWithoutExtra = {
			mappingConfigName: 'relevantTest',
			sendToFhirServer: false,
		};

		// Manually construct the expected relevantParams and hash for paramsWithoutExtra
		const expectedRelevantParams = {
			mappingConfigName: 'relevantTest',
			sendToFhirServer: false,
			fhirServerUrlOverride: null, // Defaults if not provided
		};
		const payloadString = JSON.stringify(
			expectedRelevantParams,
			Object.keys(expectedRelevantParams).sort(),
		);
		const expectedHash = crypto
			.createHash('sha256')
			.update(payloadString)
			.digest('hex');
		const expectedKey = `${prefix}:${expectedHash}`;

		const keyWithExtra = generateCacheKey(prefix, paramsWithExtra);
		const keyWithoutExtra = generateCacheKey(prefix, paramsWithoutExtra);

		expect(keyWithoutExtra).toBe(expectedKey);
		expect(keyWithExtra).toBe(expectedKey);
	});

	it('should generate a consistent key format "prefix:hash"', () => {
		const params = { mappingConfigName: 'formatTest' };
		const key = generateCacheKey(prefix, params);
		const parts = key.split(':');
		expect(parts.length).toBe(2);
		expect(parts[0]).toBe(prefix);
		expect(parts[1]).toMatch(/^[a-f0-9]{64}$/);
	});
});
