import _ from 'lodash';

export function setValue<T>(
	obj: Record<string, unknown>,
	path: string,
	value: T,
): T | undefined {
	return _.set(obj, path, value) as T;
}
