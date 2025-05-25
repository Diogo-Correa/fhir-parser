export interface FhirResourceStreamOptions {
	initialUrl: string;
	fhirServerUrl?: string;
	pageSize?: number;
	// TODO: Adicionar opções de autenticação se necessário
}
