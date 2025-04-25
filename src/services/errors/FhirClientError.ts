export class FhirClientError extends Error {
	public readonly url?: string;
	public readonly status?: number;
	public readonly responseData?: any;

	constructor(
		message: string,
		url?: string,
		status?: number,
		responseData?: any,
	) {
		super(message);
		this.name = 'FhirClientError';
		this.url = url;
		this.status = status;
		this.responseData = responseData;
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, FhirClientError);
		}
	}
}
