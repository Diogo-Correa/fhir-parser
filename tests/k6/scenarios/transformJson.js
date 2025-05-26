import { check, sleep } from 'k6';
// k6-tests/scenarios/transformJson.js
import http from 'k6/http';

export function transformJsonScenario(testData) {
	const params = {
		headers: { 'Content-Type': 'application/json' },
		tags: { scenario_name: 'transform_json_to_fhir' },
	};

	const res = http.post(
		testData.apiUrl,
		JSON.stringify(testData.payload),
		params,
	);

	if (res.status !== 200) {
		console.error(
			`[transformJsonScenario] ERROR: VU=${__VU} ITER=${__ITER} Status=${res.status} Body=${res.body}`,
		);
	}

	check(res, {
		'transformJson: status is 200': (r) => r.status === 200,
		'cache status header is present': (r) => r.headers['X-Cache'] !== undefined,
		'transformJson: no processing errors in response': (r) => {
			if (r.status === 200) {
				try {
					const respJson = r.json();
					if (respJson.success === false) return false;
					if (respJson.errors && respJson.errors.length > 0) return false;
					return true;
				} catch (e) {
					console.error(
						`[transformJsonScenario] Failed to parse JSON response: ${e} - Body: ${r.body}`,
					);
					return false;
				}
			}
		},
	});

	sleep(Math.random() * 0.5 + 0.1);
}
