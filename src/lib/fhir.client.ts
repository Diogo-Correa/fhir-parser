import axios from 'axios';

const DEFAULT_FHIR_SERVER_URL =
	process.env.FHIR_SERVER_BASE_URL || 'http://localhost:8080/fhir'; // Exemplo, pegue do .env

interface SendToFhirParams {
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	resource: any; // O recurso FHIR a ser enviado
	resourceType: string; // Tipo do recurso (ex: 'Patient', 'Observation')
	fhirServerUrl?: string; // URL para sobrescrever a padrão
	method?: 'POST' | 'PUT'; // POST para criar, PUT para atualizar (requer ID no recurso)
}

export async function sendResourceToFhirServer({
	resource,
	resourceType,
	fhirServerUrl,
	method = 'POST', // Padrão é criar
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
}: SendToFhirParams): Promise<any> {
	const targetUrlBase = fhirServerUrl || DEFAULT_FHIR_SERVER_URL;
	let targetUrl = `<span class="math-inline">\{targetUrlBase\}/</span>{resourceType}`;

	// Se for PUT e tiver ID, monta a URL com ID
	if (method === 'PUT' && resource.id) {
		targetUrl = `<span class="math-inline">\{targetUrlBase\}/</span>{resourceType}/${resource.id}`;
	} else if (method === 'PUT' && !resource.id) {
		console.warn(
			'FHIR Client: PUT method requested but resource has no ID. Falling back to POST.',
		);
		method = 'POST';
		targetUrl = `<span class="math-inline">\{targetUrlBase\}/</span>{resourceType}`;
	}

	console.log(`Sending ${method} request to FHIR server: ${targetUrl}`);

	try {
		const response = await axios({
			method: method,
			url: targetUrl,
			headers: {
				'Content-Type': 'application/fhir+json',
				Accept: 'application/fhir+json',
			},
			data: resource,
		});

		console.log(`FHIR server responded with status: ${response.status}`);
		return response.data; // Retorna o corpo da resposta do servidor FHIR
	} catch (error: unknown) {
		let errorMessage = `Failed to ${method} resource to FHIR server at ${targetUrl}.`;
		if (axios.isAxiosError(error)) {
			errorMessage += ` Status: ${error.response?.status}. Response: ${JSON.stringify(error.response?.data)}`;
			console.error(errorMessage);
		} else {
			errorMessage += ` Error: ${error.message}`;
			console.error(errorMessage, error);
		}
		throw new Error(errorMessage);
	}
}
