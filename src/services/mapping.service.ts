import { getMappingConfigurationByName } from '../repositories/mapping/getMappingConfiguration';
import { MappingConfigurationNotFoundError } from './errors/MappingConfigurationNotFoundError';

export async function getMappingByNameService(name: string) {
	const mapping = await getMappingConfigurationByName(name);

	if (!mapping) throw new MappingConfigurationNotFoundError(name);

	return mapping;
}
