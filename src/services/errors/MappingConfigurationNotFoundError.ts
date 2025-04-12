export class MappingConfigurationNotFoundError extends Error {
	constructor(configName: string) {
		super(`Mapping configuration '${configName}' not found`);
		this.name = 'MappingConfigurationNotFoundError';

		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, MappingConfigurationNotFoundError);
		}
	}
}
