import { structureDefinitionSchemas } from './structure-definition.schema';
import { transformSchemas } from './transform.schema';

export const schemas = [...transformSchemas, ...structureDefinitionSchemas];
