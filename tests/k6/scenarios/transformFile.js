import { FormData } from 'k6/form-data';
import http from 'k6/http';

const csvTestData = open('../data/small.csv', 'b');

export function transformFileScenario(data) {
	const API_BASE_URL = data.API_BASE_URL || 'http://localhost:3333/api/v1';
	const MAPPING_CONFIG_NAME_CSV =
		data.MAPPING_CONFIG_NAME_CSV || 'your-csv-to-fhir-config';

	const fd = new FormData();
	fd.append('mappingConfigName', MAPPING_CONFIG_NAME_CSV);
	fd.append('file', http.file(csvTestData, 'test_file.csv', 'text/csv'));

	const res = http.post(`${API_BASE_URL}/transform/file`, fd.body(), {
		headers: { 'Content-Type': `multipart/form-data; boundary=${fd.boundary}` },
		tags: { scenario_name: 'transform_file_csv_to_fhir' },
	});

	check(res, {
		'transformFile: status is 200': (r) => r.status === 200,
		'transformFile: no errors in response': (r) => {
			if (r.status === 200 && r.json()) {
				const respJson = r.json();
				return !respJson.errors || respJson.errors.length === 0;
			}
			return r.status !== 500;
		},
	});
	sleep(1);
}
