import { faker } from '@faker-js/faker';

import { generateSummaryReport } from './handleSummary.js';
import { transformJsonScenario } from './scenarios/transformJson.js';

export const handleSummary = generateSummaryReport;

// --- Configurações Globais ---
const API_BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3333/api/v1';
const MAPPING_CONFIG_NAME = __ENV.MAPPING_CONFIG_NAME || 'ExampleJsonToPatient';
const NUMBER_OF_RECORDS_IN_DATA_ARRAY = Number.parseInt(
	__ENV.NUM_RECORDS || '100000',
	10,
); // Padrão 100 se não definido
const SEND_TO_FHIR_SERVER = __ENV.SEND_TO_FHIR === 'true' || false;

// --- Função para gerar um único paciente fictício (COM CPF CORRIGIDO) ---
function createRandomPatient(index) {
	const sex = faker.person.sexType();
	const firstName = faker.person.firstName(sex);
	const lastName = faker.person.lastName();

	const birthDate = faker.date.birthdate({ min: 18, max: 80, mode: 'age' });
	const day = String(birthDate.getDate()).padStart(2, '0');
	const month = String(birthDate.getMonth() + 1).padStart(2, '0');
	const year = birthDate.getFullYear();
	const formattedBirthDate = `${day}/${month}/${year}`;

	// Geração de CPF corrigida e mais robusta:
	const n1 = faker.string.numeric(3);
	const n2 = faker.string.numeric(3);
	const n3 = faker.string.numeric(3);
	const n4 = faker.string.numeric(2);
	const cpfValue = `${n1}.${n2}.${n3}-${n4}`;

	return {
		pacienteIdInterno: `json-pac-${faker.string.alphanumeric({ length: 5 })}-${index}`, // Usando { length: 5 }
		cpf: cpfValue,
		nomeCompleto: `${firstName} ${lastName} JSON`,
		dataNascimento: formattedBirthDate,
		sexo: sex === 'female' ? 'F' : 'M',
		statusAtivo: faker.datatype.boolean({ probability: 0.85 }), // Usando { probability: 0.85 }
		contatos: [
			{ telefone: faker.phone.number('###########') }, // Mantém se este formato for o desejado
			{ email: faker.internet.email({ firstName, lastName }).toLowerCase() },
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
	console.log('Setting up data for k6 test...');
	const apiUrl = `${API_BASE_URL}/transform`;

	// --- Payload Determinístico para Teste de Cache (Ex: 10 records) ---
	const NUM_CACHE_RECORDS = Number.parseInt(
		__ENV.NUM_CACHE_RECORDS || '10',
		10,
	);
	const cacheTestDataArray = [];
	for (let i = 0; i < NUM_CACHE_RECORDS; i++) {
		// Gere dados que sejam os mesmos toda vez para este payload
		cacheTestDataArray.push({
			pacienteIdInterno: `cache-pac-${String(i).padStart(3, '0')}`,
			cpf: `999888777${String(i).padStart(2, '0')}`, // CPF determinístico
			nomeCompleto: `Cache Subject ${i}`,
			dataNascimento: '10/10/1990',
			sexo: 'F',
			statusAtivo: true,
			contatos: [
				{ telefone: '21977776666' },
				{ email: `cache.subject${i}@example.com` },
			],
			codigoRacaCor: '02',
		});
	}
	const cacheTestPayload = {
		mappingConfigName: MAPPING_CONFIG_NAME, // Use o mesmo mapping config
		sendToFhirServer: SEND_TO_FHIR_SERVER, // Deve ser o mesmo para a chave de cache
		data: cacheTestDataArray,
	};
	console.log(
		`Cache test payload generated with ${cacheTestDataArray.length} records.`,
	);

	// --- Payload para Teste de Carga Geral (pode ser aleatório, maior volume) ---
	const NUM_LOAD_RECORDS = Number.parseInt(__ENV.NUM_LOAD_RECORDS || '50', 10); // Diferente do NUM_RECORDS anterior
	const generalLoadDataArray = [];
	for (let i = 0; i < NUM_LOAD_RECORDS; i++) {
		generalLoadDataArray.push(createRandomPatient(i)); // Sua função Faker
	}
	const generalLoadTestPayload = {
		mappingConfigName: MAPPING_CONFIG_NAME,
		sendToFhirServer: SEND_TO_FHIR_SERVER,
		data: generalLoadDataArray,
	};
	console.log(
		`General load test payload generated with ${generalLoadDataArray.length} records.`,
	);

	return {
		apiUrl: apiUrl,
		cacheTestPayload: cacheTestPayload,
		generalLoadTestPayload: generalLoadTestPayload,
	};
}

export const options = {
	scenarios: {
		// Cenário 1: Aquecer o cache (primeiras execuções serão MISS)
		cache_warmup: {
			executor: 'per-vu-iterations',
			exec: 'runCacheWarmup',
			vus: 2,
			iterations: 2, // Envia o mesmo payload algumas vezes para garantir o cache
			maxDuration: '45s',
			tags: {
				test_type: 'cache_warmup',
				cache_behavior: 'expected_miss_then_hit',
			},
			startTime: '0s',
		},

		// Cenário 2: Testar o cache HIT (mesmo payload do warmup)
		cache_hit_test: {
			executor: 'ramping-vus',
			exec: 'runCacheHit',
			stages: [
				// Aplica alguma carga para ler do cache
				{ duration: '20s', target: 10 },
				{ duration: '30s', target: 10 },
			],
			tags: { test_type: 'cache_read', cache_behavior: 'expected_hit' },
			startTime: '30s', // Inicia após o warmup (ajuste a duração)
		},

		// (Opcional) Cenário de carga com dados variados (principalmente MISS)
		// general_json_transform_load: {
		//   executor: 'ramping-vus',
		//   exec: 'runGeneralLoad',
		//   stages: [ /* ... suas stages de carga ... */ ],
		//   tags: { test_type: 'general_load', cache_behavior: 'expected_miss' },
		//   startTime: '1m30s', // Ajuste
		// },
	},
	thresholds: {
		'http_req_duration{cache_behavior:expected_miss_then_hit}': ['p(95)<15000'], // Permite mais tempo para o primeiro processamento
		'http_req_duration{cache_behavior:expected_hit}': ['p(95)<200'], // Cache hit deve ser muito rápido
		http_req_failed: ['rate<0.05'],
		'checks{cache_behavior:expected_hit}': ['rate>0.98'],
	},
	// ... summaryTrendStats
};

// Wrappers para os cenários
export function runCacheWarmup(dataFromSetup) {
	if (!dataFromSetup || !dataFromSetup.cacheTestPayload) {
		console.error('Setup data for cache warmup missing.');
		return;
	}
	transformJsonScenario({
		apiUrl: dataFromSetup.apiUrl,
		payload: dataFromSetup.cacheTestPayload,
	});
}

export function runCacheHit(dataFromSetup) {
	if (!dataFromSetup || !dataFromSetup.cacheTestPayload) {
		console.error('Setup data for cache hit missing.');
		return;
	}
	transformJsonScenario({
		apiUrl: dataFromSetup.apiUrl,
		payload: dataFromSetup.cacheTestPayload,
	}); // MESMO PAYLOAD
}

// export function runGeneralLoad(dataFromSetup) {
//   if (!dataFromSetup || !dataFromSetup.generalLoadTestPayload) { console.error("Setup data for general load missing."); return; }
//   transformJsonScenario({ apiUrl: dataFromSetup.apiUrl, payload: dataFromSetup.generalLoadTestPayload });
// }
