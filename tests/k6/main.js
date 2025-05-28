import { faker } from '@faker-js/faker';
import { check, group, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

const timeToFirstByteUncached = new Trend('time_to_first_byte_uncached', true);
const timeToFirstByteCached = new Trend('time_to_first_byte_cached', true);

const countSuccessReqs = new Counter('http_reqs_success');
const countClientErrorReqs = new Counter('http_reqs_client_error');
const countServerErrorReqs = new Counter('http_reqs_server_error');
const countTimeoutReqs = new Counter('http_reqs_timeout');

const successfulChecksRate = new Rate('successful_checks_rate');

const API_BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3333/api/v1';
const MAPPING_CONFIG_NAME = __ENV.MAPPING_CONFIG_NAME || 'ExampleJsonToPatient';
const SEND_TO_FHIR_SERVER = __ENV.SEND_TO_FHIR === 'true' || false;

const PAYLOAD_SIZES_TO_TEST = [10, 100, 1000, 10000];
const MAX_RECORDS_TO_GENERATE = Math.max(...PAYLOAD_SIZES_TO_TEST);
const REQUEST_TIMEOUT = __ENV.REQ_TIMEOUT || '120s';

function createRandomPatient(index) {
	const sex = faker.person.sexType();
	const firstName = faker.person.firstName(sex);
	const lastName = faker.person.lastName();
	const birthDate = faker.date.birthdate({ min: 18, max: 80, mode: 'age' });
	const day = String(birthDate.getDate()).padStart(2, '0');
	const month = String(birthDate.getMonth() + 1).padStart(2, '0');
	const year = birthDate.getFullYear();
	const formattedBirthDate = `${day}/${month}/${year}`;
	const n1 = faker.string.numeric(3);
	const n2 = faker.string.numeric(3);
	const n3 = faker.string.numeric(3);
	const n4 = faker.string.numeric(2);
	const cpfValue = `${n1}${n2}${n3}${n4}`;
	return {
		pacienteIdInterno: `json-pac-${faker.string.alphanumeric({ length: 7 })}-${index}`,
		cpf: cpfValue,
		nomeCompleto: `${firstName} ${lastName} JSON Test`,
		dataNascimento: formattedBirthDate,
		sexo: sex === 'female' ? 'F' : 'M',
		statusAtivo: faker.datatype.boolean({ probability: 0.9 }),
		contatos: [
			{ telefone: faker.phone.number('219########') },
			{
				email: faker.internet
					.email({ firstName, lastName, allowSpecialCharacters: false })
					.toLowerCase(),
			},
		],
		codigoRacaCor: faker.helpers.arrayElement([
			'01',
			'02',
			'03',
			'04',
			'05',
			'99',
		]),
	};
}

export function setup() {
	console.log(
		`K6_SETUP: Generating a master data pool of ${MAX_RECORDS_TO_GENERATE} fake patient records...`,
	);
	const masterPatientDataPool = [];
	for (let i = 0; i < MAX_RECORDS_TO_GENERATE; i++) {
		masterPatientDataPool.push(createRandomPatient(i + 1));
	}
	console.log('K6_SETUP: Master data pool generation complete.');
	return {
		apiUrl: `${API_BASE_URL}/transform`,
		masterDataPool: masterPatientDataPool,
	};
}

export const options = {
	setupTimeout: __ENV.SETUP_TIMEOUT || '10m',
	scenarios: {
		escalating_payload_ddos: {
			executor: 'ramping-vus',
			exec: 'runEscalatingPayloadTest',
			stages: [
				{ duration: '30s', target: 20 },

				{ duration: '2m', target: 20 },

				{ duration: '1m', target: 50 },

				{ duration: '3m', target: 50 },

				{ duration: '30s', target: 0 },
			],
			tags: { test_type: 'escalating_payload_bulk_data' },
			startTime: '0s',
		},
	},
	thresholds: {
		http_req_duration: [`p(95)<${REQUEST_TIMEOUT.slice(0, -1)}000`],
		'http_req_duration{cache_status:miss}': ['p(95)<10000'],
		'http_req_duration{cache_status:hit}': ['p(95)<1000'],
		http_req_failed: ['rate<0.1'],
		successful_checks_rate: ['rate>0.9'],
		checks: ['rate>0.85'],
		time_to_first_byte_uncached: ['p(95)<10000'],
		time_to_first_byte_cached: ['p(95)<1000'],
		http_reqs_timeout: ['count<10'],
	},
	summaryTrendStats: [
		'avg',
		'min',
		'med',
		'max',
		'p(90)',
		'p(95)',
		'p(99)',
		'count',
	],
};

export function runEscalatingPayloadTest(setupData) {
	if (!setupData || !setupData.masterDataPool) {
		console.error(
			'K6_VU_ERROR: Master data pool from setup is not available. VU will exit.',
		);
		return;
	}

	for (const size of PAYLOAD_SIZES_TO_TEST) {
		group(`payload_size_${size}_records`, () => {
			const currentDataSlice = setupData.masterDataPool.slice(0, size);
			const payloadForThisSize = {
				mappingConfigName: MAPPING_CONFIG_NAME,
				sendToFhirServer: SEND_TO_FHIR_SERVER,
				data: currentDataSlice,
			};

			const testTargetUrl = setupData.apiUrl;
			const commonRequestParams = {
				headers: { 'Content-Type': 'application/json' },
				timeout: REQUEST_TIMEOUT,
			};

			let resUncached;
			group('attempt_cache_miss', () => {
				const tagsUncached = {
					cache_status: 'miss',
					payload_size_tag: size,
					vu_id: __VU,
					iter_id: __ITER,
				};
				resUncached = http.post(
					testTargetUrl,
					JSON.stringify(payloadForThisSize),
					{ ...commonRequestParams, tags: tagsUncached },
				);

				const isSuccessUncached = check(
					resUncached,
					{
						[`[Size ${size} - Miss] Status is 200`]: (r) => r.status === 200,
					},
					tagsUncached,
				);
				successfulChecksRate.add(isSuccessUncached, tagsUncached);

				if (resUncached.status === 0) countTimeoutReqs.add(1, tagsUncached);
				else if (resUncached.status >= 200 && resUncached.status < 300)
					countSuccessReqs.add(1, tagsUncached);
				else if (resUncached.status >= 400 && resUncached.status < 500)
					countClientErrorReqs.add(1, tagsUncached);
				else if (resUncached.status >= 500)
					countServerErrorReqs.add(1, tagsUncached);

				if (resUncached.status === 200) {
					timeToFirstByteUncached.add(
						resUncached.timings.waiting,
						tagsUncached,
					);
				}
				if (resUncached.status !== 200) {
					console.error(
						`K6_VU_ERROR: [Size ${size} - Miss] VU=${__VU}, ITER=${__ITER}, Status=${resUncached.status}, X-Cache=${resUncached.headers['X-Cache']}, Body=${resUncached.body ? resUncached.body.substring(0, 100) : 'N/A'}`,
					);
				}
			});

			sleep(1);

			if (resUncached && resUncached.status === 200) {
				let resCached;
				group('attempt_cache_hit', () => {
					const tagsCached = {
						cache_status: 'hit',
						payload_size_tag: size,
						vu_id: __VU,
						iter_id: __ITER,
					};
					resCached = http.post(
						testTargetUrl,
						JSON.stringify(payloadForThisSize),
						{ ...commonRequestParams, tags: tagsCached },
					);

					const isSuccessCached = check(
						resCached,
						{
							[`[Size ${size} - Hit] Status is 200`]: (r) => r.status === 200,
							[`[Size ${size} - Hit] X-Cache is 'hit'`]: (r) =>
								r.status === 200 &&
								r.headers['X-Cache'] &&
								r.headers['X-Cache'].toLowerCase() === 'hit',
						},
						tagsCached,
					);
					successfulChecksRate.add(isSuccessCached, tagsCached);

					if (resCached.status === 0) countTimeoutReqs.add(1, tagsCached);
					else if (resCached.status >= 200 && resCached.status < 300)
						countSuccessReqs.add(1, tagsCached);
					else if (resCached.status >= 400 && resCached.status < 500)
						countClientErrorReqs.add(1, tagsCached);
					else if (resCached.status >= 500)
						countServerErrorReqs.add(1, tagsCached);

					if (resCached.status === 200) {
						timeToFirstByteCached.add(resCached.timings.waiting, tagsCached);
					}
					if (
						resCached.status !== 200 ||
						(resCached.headers['X-Cache'] &&
							resCached.headers['X-Cache'].toLowerCase() !== 'hit')
					) {
						console.warn(
							`K6_VU_WARN: [Size ${size} - Hit Attempt] VU=${__VU}, ITER=${__ITER}, Status=${resCached.status}, X-Cache=${resCached.headers['X-Cache']}, Body=${resCached.body ? resCached.body.substring(0, 100) : 'N/A'}`,
						);
					}
				});
			} else {
				console.warn(
					`K6_VU_WARN: [Size ${size}] Skipping cache hit test because initial (miss) request did not return 200. Actual Status: ${resUncached ? resUncached.status : 'N/A'}`,
				);
			}
			sleep(1);
		});
	}
}

export function handleSummary(data) {
	console.log('K6_SUMMARY: Generating Final Test Execution Summary...');

	// Função auxiliar para obter um valor de métrica (p.ex. p(95)) de forma segura
	const getMetricSubValue = (
		metricName,
		subMetricKey,
		defaultValue = 'N/A',
	) => {
		if (
			data.metrics &&
			data.metrics[metricName] &&
			data.metrics[metricName].values &&
			data.metrics[metricName].values[subMetricKey] !== undefined
		) {
			return data.metrics[metricName].values[subMetricKey];
		}
		return defaultValue;
	};

	// Função auxiliar para obter um valor de métrica (p.ex. p(95)) de uma métrica tagueada
	const getTaggedMetricSubValue = (
		baseMetricName,
		subMetricKey,
		tagsObject,
		defaultValue = 'N/A',
	) => {
		if (
			!data.metrics ||
			!data.metrics[baseMetricName] ||
			!data.metrics[baseMetricName].values
		) {
			return defaultValue;
		}
		// Constrói a string da tag como o k6 a usa internamente para chaves de submétricas
		// Ex: "p(95){tagKey1=tagValue1,tagKey2=tagValue2}"
		const tagStringParts = [];
		for (const key in tagsObject) {
			tagStringParts.push(`${key}=${tagsObject[key]}`);
		}
		const tagStringForLookup = `{${tagStringParts.join(',')}}`; // Ex: {cache_status=miss,payload_size_tag=100}
		const metricKeyWithTags = `${subMetricKey}${tagStringForLookup}`;

		if (data.metrics[baseMetricName].values[metricKeyWithTags] !== undefined) {
			return data.metrics[baseMetricName].values[metricKeyWithTags];
		}
		// Tenta também sem as tags se for uma métrica agregada que queremos (ex: count global)
		if (
			data.metrics[baseMetricName].values[subMetricKey] !== undefined &&
			Object.keys(tagsObject).length === 0
		) {
			return data.metrics[baseMetricName].values[subMetricKey];
		}

		return defaultValue;
	};

	const totalRequests = getMetricSubValue('http_reqs', 'count', 0);
	const failedRequestsRate = getMetricSubValue('http_req_failed', 'rate', 0);
	const failedRequestsCount = Math.round(failedRequestsRate * totalRequests);

	let summaryOutput = `
  ----------------------------------------------------------------------------------
  K6 Test Execution Report
  ----------------------------------------------------------------------------------
  Target API: ${API_BASE_URL}
  Mapping Config: ${MAPPING_CONFIG_NAME}
  Payload Sizes Tested: [${PAYLOAD_SIZES_TO_TEST.join(', ')}] records per request
  Max Records in Setup Pool: ${MAX_RECORDS_TO_GENERATE}
  Request Timeout: ${REQUEST_TIMEOUT_SECONDS}s
  ----------------------------------------------------------------------------------
  Overall VUs Max: ${getMetricSubValue('vus_max', 'value', 'N/A')}
  Total Iterations (VU loops): ${getMetricSubValue('iterations', 'count', 'N/A')}
  Test Duration (approx): ${((getMetricSubValue('iteration_duration', 'avg', 0) * getMetricSubValue('iterations', 'count', 0)) / 1000 / 60).toFixed(2)} minutes 
						(ou ${(data.duration / 1000 / 60).toFixed(2)} minutes a partir de data.duration)
  ----------------------------------------------------------------------------------
  HTTP Request Summary:
	Total HTTP Requests: ${totalRequests}
	Successful (2xx): ${getMetricSubValue('http_reqs_ok_count', 'count', 0)}
	Client Errors (4xx): ${getMetricSubValue('http_reqs_4xx_count', 'count', 0)}
	Server Errors (5xx): ${getMetricSubValue('http_reqs_5xx_count', 'count', 0)}
	k6 Timeouts (status 0): ${getMetricSubValue('http_reqs_timeout_k6_count', 'count', 0)}
	Total Failed (k6 'http_req_failed'): ${failedRequestsCount} (${(failedRequestsRate * 100).toFixed(2)}%)
  ----------------------------------------------------------------------------------
  Checks Summary:
	Total Checks Performed: ${getMetricSubValue('checks', 'passes', 0) + getMetricSubValue('checks', 'fails', 0)}
	Checks Passed: ${getMetricSubValue('checks', 'passes', 0)}
	Checks Failed: ${getMetricSubValue('checks', 'fails', 0)}
	Checks Pass Rate: ${(getMetricSubValue('checks', 'rate', 0) * 100).toFixed(2)}%
  ----------------------------------------------------------------------------------
  Performance Trends (p95 in seconds):
	TTFB Uncached (All Sizes): ${(getMetricSubValue('ttfb_uncached_ms', 'p(95)', 0) / 1000).toFixed(3)} s
	TTFB Cached (All Sizes): ${(getMetricSubValue('ttfb_cached_ms', 'p(95)', 0) / 1000).toFixed(3)} s
	API Processing Uncached (All Sizes): ${(getMetricSubValue('api_processing_time_uncached_ms', 'p(95)', 0) / 1000).toFixed(3)} s
	API Processing Cached (All Sizes): ${(getMetricSubValue('api_processing_time_cached_ms', 'p(95)', 0) / 1000).toFixed(3)} s
  ----------------------------------------------------------------------------------
  Performance by Payload Size (p95 http_req_duration in seconds):
  `;

	for (const size of PAYLOAD_SIZES_TO_TEST) {
		const tagsMiss = { cache_status: 'miss', payload_size_tag: String(size) };
		const tagsHit = { cache_status: 'hit', payload_size_tag: String(size) };

		const p95MissDuration = (
			getTaggedMetricSubValue('http_req_duration', 'p(95)', tagsMiss, 0) / 1000
		).toFixed(3);
		const countMissDuration = getTaggedMetricSubValue(
			'http_req_duration',
			'count',
			tagsMiss,
			0,
		);

		const p95HitDuration = (
			getTaggedMetricSubValue('http_req_duration', 'p(95)', tagsHit, 0) / 1000
		).toFixed(3);
		const countHitDuration = getTaggedMetricSubValue(
			'http_req_duration',
			'count',
			tagsHit,
			0,
		);

		summaryOutput += `  Payload ${String(size).padEnd(5)} recs: Miss Dura: ${String(p95MissDuration).padEnd(7)}s (count: ${String(countMissDuration).padEnd(3)}) | Hit Dura: ${String(p95HitDuration).padEnd(7)}s (count: ${String(countHitDuration).padEnd(3)})\n`;
	}
	summaryOutput +=
		'----------------------------------------------------------------------------------\n';

	console.log(summaryOutput);

	return {
		stdout: summaryOutput,
		'summary_report.json': JSON.stringify(data),
	};
}
