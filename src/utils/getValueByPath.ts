import _ from 'lodash';

export function getValue<T>(
	obj: Record<string, unknown>,
	path: string,
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	defaultValue?: any,
): T | undefined {
	return _.get(obj, path, defaultValue) as T;
}
