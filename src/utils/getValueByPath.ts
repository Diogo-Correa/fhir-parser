import _ from 'lodash';
import { parsePathSegments } from './parsePathSegments';

function getDeepFhirPathValue(
	currentContext: any,
	pathSegments: string[],
	defaultValue?: any,
): any {
	if (currentContext === undefined || currentContext === null) {
		return defaultValue;
	}
	if (pathSegments.length === 0) {
		return currentContext;
	}

	const segmentRaw = pathSegments[0];
	const remainingSegments = pathSegments.slice(1);
	let nextContext: any;

	if (Array.isArray(currentContext)) {
		const targetArray = currentContext;
		if (/^\d+$/.test(segmentRaw)) {
			const index = Number.parseInt(segmentRaw, 10);
			nextContext = index < targetArray.length ? targetArray[index] : undefined;
		} else if (segmentRaw.startsWith('[?') && segmentRaw.endsWith(']')) {
			const filterMatch = segmentRaw.match(
				/^\[\?([a-zA-Z0-9_:]+)='([^']*)'\]$/,
			);
			if (filterMatch) {
				const filterKey = filterMatch[1];
				const filterValue = filterMatch[2];
				const foundElement = targetArray.find(
					(item) =>
						typeof item === 'object' &&
						item !== null &&
						_.get(item, filterKey) === filterValue,
				);
				nextContext = foundElement;
			} else {
				nextContext = undefined;
			}
		} else if (
			targetArray.length > 0 &&
			typeof targetArray[0] === 'object' &&
			targetArray[0] !== null
		) {
			const propertyOfFirstItem = _.get(targetArray[0], segmentRaw);
			return getDeepFhirPathValue(
				propertyOfFirstItem,
				remainingSegments,
				defaultValue,
			);
		} else {
			nextContext = undefined;
		}
	} else {
		if (remainingSegments.length > 0 && remainingSegments[0].startsWith('[?')) {
			const arrayFromObject = _.get(currentContext, segmentRaw);
			const filterSegment = remainingSegments[0];
			const actualRemainingSegments = remainingSegments.slice(1);
			return getDeepFhirPathValue(
				arrayFromObject,
				[filterSegment, ...actualRemainingSegments],
				defaultValue,
			);
		}
		nextContext = _.get(currentContext, segmentRaw);
	}
	return getDeepFhirPathValue(nextContext, remainingSegments, defaultValue);
}

export function getValue<T>(
	obj: Record<string, unknown> | any[] | undefined | null,
	path?: string | null,
	defaultValue?: any,
): T | undefined {
	if (obj === undefined || obj === null) {
		return defaultValue as T | undefined;
	}
	if (typeof path !== 'string' || !path) {
		return defaultValue as T | undefined;
	}

	const segments = parsePathSegments(path);
	if (!segments || segments.length === 0) {
		if (!path.includes('.') && !path.includes('[')) {
			return _.get(obj, path, defaultValue) as T | undefined;
		}
		// console.warn(`[getValueByPath] Path parser returned no segments for non-trivial path: '${path}'.`);
		return defaultValue as T | undefined;
	}
	return getDeepFhirPathValue(obj, segments, defaultValue) as T | undefined;
}
