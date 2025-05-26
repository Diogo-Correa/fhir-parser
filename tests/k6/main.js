import { faker } from '@faker-js/faker';
import { check, group, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const timeToFirstByteUncached = new Trend('ttfb_uncached_ms', true);
const timeToFirstByteCached = new Trend('ttfb_cached_ms', true);
const processingTimeUncached = new Trend(
	'api_processing_time_uncached_ms',
	true,
);
const processingTimeCached = new Trend('api_processing_time_cached_ms', true);
const countSuccessReqs = new Counter('http_reqs_ok_count');
const countRateLimitBlockedReqs = new Counter('http_reqs_rate_limited_count');
const countClientErrorReqs = new Counter('http_reqs_other_4xx_count');
const countServerErrorReqs = new Counter('http_reqs_5xx_count');
const countTimeoutReqs = new Counter('http_reqs_timeout_k6_count');

const API_BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3333/api/v1';
const MAPPING_CONFIG_NAME = __ENV.MAPPING_CONFIG_NAME || 'ExampleJsonToPatient';
const SEND_TO_FHIR_SERVER = __ENV.SEND_TO_FHIR === 'true' || false;

const PAYLOAD_SIZES_TO_TEST = [
	Number.parseInt(__ENV.SIZE1 || '10'),
	Number.parseInt(__ENV.SIZE2 || '100'),
	Number.parseInt(__ENV.SIZE3 || '500'),
	Number.parseInt(__ENV.SIZE4 || '1000'),
	Number.parseInt(__ENV.SIZE5 || '5000'),
	Number.parseInt(__ENV.SIZE6 || '10000'),
];
const MAX_RECORDS_TO_GENERATE = Math.max(...PAYLOAD_SIZES_TO_TEST);
const REQUEST_TIMEOUT_SECONDS_STR = __ENV.REQ_TIMEOUT_S || '180';
const REQUEST_TIMEOUT_SECONDS_NUM = Number.parseInt(
	REQUEST_TIMEOUT_SECONDS_STR,
	10,
);

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
	const cpfValue = `${n1}.${n2}.${n3}-${n4}`;
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
	console.log(
		`K6_SETUP: Master data pool generation complete. Will test payload sizes: [${PAYLOAD_SIZES_TO_TEST.join(', ')}]`,
	);
	return {
		apiUrl: `${API_BASE_URL}/transform`,
		masterDataPool: masterPatientDataPool,
		payloadSizes: PAYLOAD_SIZES_TO_TEST,
	};
}

export const options = {
	setupTimeout: __ENV.SETUP_TIMEOUT || '5m',
	scenarios: {
		escalating_payload_ddos: {
			executor: 'ramping-vus',
			exec: 'runEscalatingPayloadTest',
			stages: [
				{ duration: '30s', target: 5 },
				{ duration: '1m', target: 5 },
				{ duration: '30s', target: 10 },
				{ duration: '1m30s', target: 10 },
				{ duration: '10s', target: 0 },
			],
			tags: { test_type: 'escalating_payload_and_rate_limit' },
			startTime: '0s',
		},
	},
	thresholds: {
		http_req_duration: [`p(95)<${REQUEST_TIMEOUT_SECONDS_NUM * 1000}`],
		'http_req_duration{cache_status:miss}': ['p(95)<10000'],
		'http_req_duration{cache_status:hit}': ['p(95)<1000'],

		ttfb_uncached_ms: ['p(95)<8000'],
		ttfb_cached_ms: ['p(95)<500'],

		api_processing_time_uncached_ms: [
			`p(95)<${REQUEST_TIMEOUT_SECONDS_NUM * 1000}`,
		],
		api_processing_time_cached_ms: ['p(95)<800'],

		http_req_failed: ['rate<0.15'],
		checks: ['rate>0.75'],

		http_reqs_ok_count: ['count>0'],
		http_reqs_other_4xx_count: ['count<50'],
		http_reqs_rate_limited_count: ['count>=0'],
		http_reqs_5xx_count: ['count<10'],
		http_reqs_timeout_k6_count: ['count<20'],
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
	if (!setupData || !setupData.masterDataPool || !setupData.payloadSizes) {
		console.error(
			'K6_VU_ERROR: Data from setup function is not available. VU will exit.',
		);
		return;
	}

	for (const size of setupData.payloadSizes) {
		group(`payload_size_${String(size).padStart(5, '0')}_records`, () => {
			const currentDataSlice = setupData.masterDataPool.slice(0, size);
			const payloadForThisSize = {
				mappingConfigName: MAPPING_CONFIG_NAME,
				sendToFhirServer: SEND_TO_FHIR_SERVER,
				data: currentDataSlice,
			};

			const testTargetUrl = setupData.apiUrl;
			const commonRequestParams = {
				headers: { 'Content-Type': 'application/json' },
				timeout: REQUEST_TIMEOUT_SECONDS_STR,
				expectedStatuses: { min: 200, max: 299, 403: true, 429: true },
			};

			let resUncached;
			group('attempt_cache_miss_then_hit_pair', () => {
				const tagsUncached = {
					cache_status: 'miss',
					payload_size_tag: String(size),
				};
				resUncached = http.post(
					testTargetUrl,
					JSON.stringify(payloadForThisSize),
					{ ...commonRequestParams, tags: tagsUncached },
				);

				let isUncachedSuccess = false;
				let isUncachedRateLimited = false;

				if (resUncached.status === 0) {
					countTimeoutReqs.add(1, tagsUncached);
				} else if (
					resUncached.status === 403 &&
					resUncached.body &&
					String(resUncached.body).includes('Rate limit exceeded')
				) {
					countRateLimitBlockedReqs.add(1, tagsUncached);
					isUncachedRateLimited = true;
				} else if (resUncached.status === 429) {
					countRateLimitBlockedReqs.add(1, tagsUncached);
					isUncachedRateLimited = true;
				} else if (resUncached.status >= 200 && resUncached.status < 300) {
					countSuccessReqs.add(1, tagsUncached);
					isUncachedSuccess = true;
				} else if (resUncached.status >= 400 && resUncached.status < 500) {
					countClientErrorReqs.add(1, tagsUncached);
				} else if (resUncached.status >= 500) {
					countServerErrorReqs.add(1, tagsUncached);
				}

				check(
					resUncached,
					{
						[`[Size ${size} - Miss] Status é 200 (OK) ou 403/429 (Rate Limited)`]:
							(r) =>
								r.status === 200 ||
								(r.status === 403 &&
									r.body &&
									String(r.body).includes('Rate limit exceeded')) ||
								r.status === 429,
					},
					tagsUncached,
				);

				if (isUncachedSuccess) {
					check(
						resUncached,
						{
							[`[Size ${size} - Miss] Se 200, X-Cache header é 'miss' ou ausente`]:
								(r) =>
									!r.headers['X-Cache'] ||
									r.headers['X-Cache'].toLowerCase() === 'miss',
						},
						tagsUncached,
					);
					timeToFirstByteUncached.add(
						resUncached.timings.waiting,
						tagsUncached,
					);
					processingTimeUncached.add(
						resUncached.timings.duration,
						tagsUncached,
					);
				} else if (!isUncachedRateLimited && resUncached.status !== 0) {
					console.warn(
						`K6_VU_WARN: [Size ${size} - Miss Attempt] Status:${resUncached.status}, X-Cache:${resUncached.headers['X-Cache']}, Err:${resUncached.error}, Body:${resUncached.body ? String(resUncached.body).substring(0, 60) : 'N/A'}`,
					);
				} else if (isUncachedRateLimited) {
					console.log(
						`K6_VU_INFO: [Size ${size} - Miss Attempt] Rate limited. Status:${resUncached.status}`,
					);
				}
				sleep(1);

				if (isUncachedSuccess) {
					let resCached;
					const tagsCached = {
						cache_status: 'hit',
						payload_size_tag: String(size),
					};
					resCached = http.post(
						testTargetUrl,
						JSON.stringify(payloadForThisSize),
						{ ...commonRequestParams, tags: tagsCached },
					);

					let isCachedRateLimited = false;
					if (resCached.status === 0) {
						countTimeoutReqs.add(1, tagsCached);
					} else if (
						resCached.status === 403 &&
						resCached.body &&
						String(resCached.body).includes('Rate limit exceeded')
					) {
						countRateLimitBlockedReqs.add(1, tagsCached);
						isCachedRateLimited = true;
					} else if (resCached.status === 429) {
						countRateLimitBlockedReqs.add(1, tagsCached);
						isCachedRateLimited = true;
					} else if (resCached.status >= 200 && resCached.status < 300) {
						countSuccessReqs.add(1, tagsCached);
					} else if (resCached.status >= 400 && resCached.status < 500) {
						countClientErrorReqs.add(1, tagsCached);
					} else if (resCached.status >= 500) {
						countServerErrorReqs.add(1, tagsCached);
					}

					let hitCheckPassed = check(
						resCached,
						{
							[`[Size ${size} - Hit] Status é 200 (OK)`]: (r) =>
								r.status === 200,
						},
						tagsCached,
					);

					if (resCached.status === 200) {
						hitCheckPassed =
							hitCheckPassed &&
							check(
								resCached,
								{
									[`[Size ${size} - Hit] Se 200, X-Cache header é 'hit'`]: (
										r,
									) =>
										r.headers['X-Cache'] &&
										r.headers['X-Cache'].toLowerCase() === 'hit',
								},
								tagsCached,
							);
						timeToFirstByteCached.add(resCached.timings.waiting, tagsCached);
						processingTimeCached.add(resCached.timings.duration, tagsCached);

						if (
							!(
								resCached.headers['X-Cache'] &&
								resCached.headers['X-Cache'].toLowerCase() === 'hit'
							)
						) {
							console.warn(
								`K6_VU_WARN: [Size ${size} - Hit Attempt BUT X-Cache IS '${resCached.headers['X-Cache']}'] Status:${resCached.status}`,
							);
						}
					} else if (!isCachedRateLimited && resCached.status !== 0) {
						console.warn(
							`K6_VU_WARN: [Size ${size} - Hit Attempt] Status:${resCached.status}, X-Cache:${resCached.headers['X-Cache']}, Err:${resCached.error}, Body:${resCached.body ? String(resCached.body).substring(0, 60) : 'N/A'}`,
						);
					} else if (isCachedRateLimited) {
						console.log(
							`K6_VU_INFO: [Size ${size} - Hit Attempt] Rate limited. Status:${resCached.status}`,
						);
					}
				} else {
					console.log(
						`K6_VU_INFO: [Size ${size}] Skipping cache hit test because initial (miss) request was not 200 (was ${resUncached.status}).`,
					);
				}
			});
			sleep(1);
		});
	}
}

export function handleSummary(data) {
	console.log('K6_SUMMARY: Generating Final Test Execution Summary...');

	const getMetricValue = (
		metricFullName,
		valueType = 'count',
		defaultValue = 0,
	) => {
		const metric = data.metrics[metricFullName];
		if (metric && metric.values && metric.values[valueType] !== undefined) {
			return metric.values[valueType];
		}
		if (
			metric &&
			metric.values &&
			metric.values[`${valueType}{}`] !== undefined
		) {
			return metric.values[`${valueType}{}`];
		}
		return defaultValue;
	};
	const getMetricRate = (metricFullName, defaultValue = 0) => {
		const metric = data.metrics[metricFullName];
		if (metric && metric.values && metric.values.rate !== undefined) {
			return metric.values.rate;
		}
		return defaultValue;
	};
	const getMetricTrend = (
		metricFullName,
		percentile = 'p(95)',
		defaultValue = 'N/A',
	) => {
		const metric = data.metrics[metricFullName];
		if (!metric || !metric.values || metric.values[percentile] === undefined) {
			return defaultValue;
		}
		return (metric.values[percentile] / 1000).toFixed(3);
	};

	const getTaggedMetricSubValue = (
		baseMetricName,
		subMetricKey,
		tagsObject,
		defaultValue = 0,
	) => {
		const metric = data.metrics[baseMetricName];
		if (!metric || !metric.values) {
			return defaultValue;
		}
		const tagStringParts = [];

		for (const key in tagsObject)
			tagStringParts.push(`${key}=${tagsObject[key]}`);

		const tagStringForLookup =
			tagStringParts.length > 0 ? `{${tagStringParts.join(',')}}` : '';

		const metricKeyWithTags = `${subMetricKey}${tagStringForLookup}`;

		if (metric.values[metricKeyWithTags] !== undefined)
			return metric.values[metricKeyWithTags];
		if (
			tagStringParts.length === 0 &&
			metric.values[subMetricKey] !== undefined
		)
			return metric.values[subMetricKey];

		return defaultValue;
	};

	const totalRequests = getMetricValue('http_reqs', 'count');
	const failedRequestsRate = getMetricRate('http_req_failed');
	const failedRequestsCount = Math.round(failedRequestsRate * totalRequests);
	const k6RequestTimeoutForSummary =
		__ENV.REQ_TIMEOUT_S || REQUEST_TIMEOUT_SECONDS_STR.replace('s', '');

	let summaryOutput = `
----------------------------------------------------------------------------------
K6 Test Execution Report (incl. Rate Limit Analysis)
----------------------------------------------------------------------------------
Target API: ${API_BASE_URL}
Mapping Config: ${MAPPING_CONFIG_NAME}
Payload Sizes Tested: [${PAYLOAD_SIZES_TO_TEST.join(', ')}] records per request
Max Records in Setup Pool: ${MAX_RECORDS_TO_GENERATE}
K6 Request Timeout Config: ${k6RequestTimeoutForSummary}s
----------------------------------------------------------------------------------
Overall VUs Max: ${getMetricValue('vus_max', 'value', 'N/A')}
Total Iterations (VU loops): ${getMetricValue('iterations', 'count', 'N/A')}
Test Duration: ${(data.duration / 1000 / 60).toFixed(2)} minutes
----------------------------------------------------------------------------------
HTTP Request Summary:
  Total HTTP Requests Issued by k6: ${totalRequests}
  Successful (2xx): ${getMetricValue('http_reqs_ok_count', 'count')}
  Rate Limited (403/429): ${getMetricValue('http_reqs_rate_limited_count', 'count')}
  Other Client Errors (4xx): ${getMetricValue('http_reqs_other_4xx_count', 'count')}
  Server Errors (5xx): ${getMetricValue('http_reqs_5xx_count', 'count')}
  k6 Client-Side Timeouts (Status 0): ${getMetricValue('http_reqs_timeout_k6_count', 'count')}
  Total k6 Marked Failed HTTP Requests: ${failedRequestsCount} (${(failedRequestsRate * 100).toFixed(2)}%)
----------------------------------------------------------------------------------
Checks Summary:
  Total Checks Performed: ${getMetricValue('checks', 'passes') + getMetricValue('checks', 'fails')}
  Checks Passed: ${getMetricValue('checks', 'passes')}
  Checks Failed: ${getMetricValue('checks', 'fails')}
  Checks Pass Rate: ${(getMetricRate('checks') * 100).toFixed(2)}%
----------------------------------------------------------------------------------
Performance Trends (p95 in seconds):
  TTFB Uncached (All Sizes): ${getMetricTrend('ttfb_uncached_ms')} s
  TTFB Cached (All Sizes): ${getMetricTrend('ttfb_cached_ms')} s
  API Processing Uncached (All Sizes): ${getMetricTrend('api_processing_time_uncached_ms')} s
  API Processing Cached (All Sizes): ${getMetricTrend('api_processing_time_cached_ms')} s
----------------------------------------------------------------------------------
Performance by Payload Size (p95 http_req_duration in seconds):
`;

	for (const size of PAYLOAD_SIZES_TO_TEST) {
		const tagsMiss = { cache_status: 'miss', payload_size_tag: String(size) };
		const tagsHit = { cache_status: 'hit', payload_size_tag: String(size) };

		const p95MissDuration = (
			getTaggedMetricSubValue('http_req_duration', 'p(95)', tagsMiss, 0) / 1000
		).toFixed(3);
		const countMissReqs = getTaggedMetricSubValue(
			'http_reqs',
			'count',
			tagsMiss,
			0,
		);

		const p95HitDuration = (
			getTaggedMetricSubValue('http_req_duration', 'p(95)', tagsHit, 0) / 1000
		).toFixed(3);
		const countHitReqs = getTaggedMetricSubValue(
			'http_reqs',
			'count',
			tagsHit,
			0,
		);

		const countRateLimitedMiss = getTaggedMetricSubValue(
			'http_reqs_rate_limited_count',
			'count',
			tagsMiss,
			0,
		);
		const countRateLimitedHit = getTaggedMetricSubValue(
			'http_reqs_rate_limited_count',
			'count',
			tagsHit,
			0,
		);

		summaryOutput += `  Payload ${String(size).padEnd(5)} recs: Miss Dura: ${String(p95MissDuration).padEnd(7)}s (reqs: ${String(countMissReqs).padEnd(3)}, rateLimit: ${countRateLimitedMiss}) | Hit Dura: ${String(p95HitDuration).padEnd(7)}s (reqs: ${String(countHitReqs).padEnd(3)}, rateLimit: ${countRateLimitedHit})\n`;
	}
	summaryOutput +=
		'----------------------------------------------------------------------------------\n';

	console.log(summaryOutput);

	return {
		stdout: summaryOutput,
		'summary_report.json': JSON.stringify(data),
	};
}
