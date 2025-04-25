export class StructureDefinitionNotProcessedError extends Error {
	constructor(identifier: string) {
		super(
			`Required StructureDefinition '${identifier}' has not been processed or was not found in the database.`,
		);
		this.name = 'StructureDefinitionNotProcessedError';
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, StructureDefinitionNotProcessedError);
		}
	}
}
