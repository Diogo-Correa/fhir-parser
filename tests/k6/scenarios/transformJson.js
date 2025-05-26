import { check, sleep } from 'k6';
// k6-tests/scenarios/transformJson.js
import http from 'k6/http';

export function transformJsonScenario(testData) {
	// testData é o payload completo, incluindo mappingConfigName e o array 'data'
	// A API_BASE_URL será definida no payload principal ou como uma constante no main.js

	const params = {
		headers: { 'Content-Type': 'application/json' },
		tags: { scenario_name: 'transform_json_to_fhir' },
	};

	const res = http.post(
		testData.apiUrl,
		JSON.stringify(testData.payload),
		params,
	);

	// Adicionando log para depuração (remova para testes de carga reais)
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
			// Se não for 200, o check de status já falhou. Para este check, consideramos válido não ter erros de processamento.
			// Ou, dependendo da sua lógica, você pode querer que este check falhe se o status não for 200.
			// Por simplicidade, vamos focar na resposta 200 para este check específico.
			return r.status === 200; // Garante que este check só "passa" em cenários de sucesso real
		},
	});

	sleep(Math.random() * 0.5 + 0.1); // Pausa pequena: 0.1s a 0.6s
}
