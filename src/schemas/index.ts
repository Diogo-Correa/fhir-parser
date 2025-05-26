import { mappingSchemas } from './mapping.schema';
import { mappingUtilitySchemas } from './mappingUtility.schema';
import { structureDefinitionSchemas } from './structure-definition.schema';
import { transformSchemas } from './transform.schema';

export const schemas = [
	...transformSchemas,
	...structureDefinitionSchemas,
	...mappingSchemas,
	...mappingUtilitySchemas,
];
