export class MultipartRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MultipartRequestError';
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, MultipartRequestError);
		}
	}
}
