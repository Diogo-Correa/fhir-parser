import axios from 'axios';
import { FhirClientError } from '../services/errors/FhirClientError';

const DEFAULT_FHIR_SERVER_URL =
	process.env.FHIR_SERVER_BASE_URL || 'http://localhost:8080/fhir';

interface SendToFhirParams {
	resource: any;
	resourceType: string;
	fhirServerUrl?: string;
	method?: 'POST' | 'PUT';
}

export async function sendResourceToFhirServer({
	resource,
	resourceType,
	fhirServerUrl,
	method = 'POST',
}: SendToFhirParams): Promise<any> {
	const targetUrlBase = fhirServerUrl || DEFAULT_FHIR_SERVER_URL;
	let targetUrl = `${targetUrlBase}/${resourceType}`;
	let effectiveMethod = method;

	if (method === 'PUT' && resource.id) {
		targetUrl = `${targetUrlBase}/${resourceType}/${resource.id}`;
	} else if (method === 'PUT' && !resource.id) {
		console.warn(
			`FHIR Client: PUT method requested for ${resourceType} but resource has no ID. Falling back to POST.`,
		);
		effectiveMethod = 'POST';
		targetUrl = `${targetUrlBase}/${resourceType}`;
	}

	console.log(
		`FHIR Client: Sending ${effectiveMethod} request to: ${targetUrl}`,
	);

	try {
		const response = await axios({
			method: effectiveMethod,
			url: targetUrl,
			headers: {
				'Content-Type': 'application/fhir+json;charset=utf-8',
				Accept: 'application/fhir+json',
				// TODO: Adicionar cabeçalhos de autenticação (Authorization: Bearer TOKEN) se necessário
			},
			data: resource,
			timeout: 30000,
		});

		console.log(
			`FHIR Client: ${effectiveMethod} to ${targetUrl} successful (Status: ${response.status})`,
		);
		// Retorna o recurso criado/atualizado (com ID, meta, etc.) ou OperationOutcome em caso de sucesso com issues
		return response.data;
	} catch (error: any) {
		let status: number | undefined;
		let responseData: any;
		let errorMessage = `FHIR Client: Failed to ${effectiveMethod} resource to ${targetUrl}.`;

		if (axios.isAxiosError(error)) {
			status = error.response?.status;
			responseData = error.response?.data;
			errorMessage += ` Status: ${status}.`;
			// Tenta extrair mensagem de OperationOutcome se existir
			const ooDetails =
				responseData?.issue?.[0]?.diagnostics ?? JSON.stringify(responseData);
			errorMessage += ` Response: ${ooDetails}`;
			console.error(
				`FHIR Client Error: ${errorMessage}`,
				error.response?.config?.data,
			); // Loga o erro e o que foi enviado
		} else {
			errorMessage += ` Error: ${error.message}`;
			console.error(`FHIR Client Error: ${errorMessage}`, error);
		}
		// Lança um erro customizado com mais detalhes
		throw new FhirClientError(errorMessage, targetUrl, status, responseData);
	}
}
