export class InvalidMappingError extends Error {
	public readonly mappingName: string;
	public readonly invalidPath: string;
	public readonly structureDefinitionUrl: string;

	constructor(
		mappingName: string,
		invalidPath: string,
		structureDefinitionUrl: string,
	) {
		super(
			`Mapping '${mappingName}' contains invalid FHIR path '${invalidPath}' according to StructureDefinition '${structureDefinitionUrl}'.`,
		);
		this.name = 'InvalidMappingError';
		this.mappingName = mappingName;
		this.invalidPath = invalidPath;
		this.structureDefinitionUrl = structureDefinitionUrl;

		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, InvalidMappingError);
		}
	}
}
