import _ from 'lodash';
import { parsePathSegments } from './parsePathSegments';

export interface SdElement {
	path: string;
	max?: string | null;
}

function findElementDefinitionByFullPath(
	fullPath: string,
	allSdElements: SdElement[],
): SdElement | undefined {
	let element = allSdElements.find((el) => el.path === fullPath);
	if (element) return element;

	const pathWithoutIndices = fullPath.replace(/\[\d+\]/g, '');
	if (pathWithoutIndices !== fullPath) {
		element = allSdElements.find((el) => el.path === pathWithoutIndices);
	}
	return element;
}

function setDeepFhirPath(
	currentContextOrArray: any,
	segments: string[],
	valueToSet: any,
	allSdElements: SdElement[],
	currentFullPathPrefix: string,
): void {
	if (segments.length === 0) return;

	const segmentRaw = segments[0];
	const remainingSegments = segments.slice(1);

	if (Array.isArray(currentContextOrArray)) {
		const targetArray = currentContextOrArray;
		let itemForRecursion: any;
		let nextPathPrefixWithIndex = currentFullPathPrefix;

		if (/^\d+$/.test(segmentRaw)) {
			const indexToOperateOn = Number.parseInt(segmentRaw, 10);
			nextPathPrefixWithIndex = `${currentFullPathPrefix}[${indexToOperateOn}]`;
			while (targetArray.length <= indexToOperateOn) {
				targetArray.push(remainingSegments.length === 0 ? null : {});
			}

			if (remainingSegments.length === 0) {
				targetArray[indexToOperateOn] = valueToSet;
			} else {
				itemForRecursion = targetArray[indexToOperateOn];
				if (typeof itemForRecursion !== 'object' || itemForRecursion === null) {
					itemForRecursion = {};
					targetArray[indexToOperateOn] = itemForRecursion;
				}
				setDeepFhirPath(
					itemForRecursion,
					remainingSegments,
					valueToSet,
					allSdElements,
					nextPathPrefixWithIndex,
				);
			}
		} else if (segmentRaw.startsWith('[?') && segmentRaw.endsWith(']')) {
			const filterMatch = segmentRaw.match(
				/^\[\?([a-zA-Z0-9_:]+)='([^']*)'\]$/,
			);
			if (filterMatch) {
				const filterKey = filterMatch[1];
				const filterValue = filterMatch[2];
				let foundElement = targetArray.find(
					(item) =>
						typeof item === 'object' &&
						item !== null &&
						_.get(item, filterKey) === filterValue,
				);
				if (!foundElement) {
					foundElement = { [filterKey]: filterValue };
					targetArray.push(foundElement);
				}
				setDeepFhirPath(
					foundElement,
					remainingSegments,
					valueToSet,
					allSdElements,
					`${currentFullPathPrefix}${segmentRaw}`,
				);
			} else {
				/* Filtro malformado */
				console.error(
					`[setValueByPath] Filter segment '${segmentRaw}' malformed. Path: ${currentFullPathPrefix}${segmentRaw}. This may indicate an issue with path parsing or structure.`,
				);
			}
		} else {
			// Segmento é nome de propriedade (ex: "use") a ser aplicado a elementos do array
			if (targetArray.length === 0 && segments.length > 0) {
				const newArrayItem = {};
				targetArray.push(newArrayItem);
				setDeepFhirPath(
					newArrayItem,
					segments,
					valueToSet,
					allSdElements,
					`${currentFullPathPrefix}[0]`,
				);
			} else {
				for (let i = 0; i < targetArray.length; i++) {
					if (typeof targetArray[i] === 'object' && targetArray[i] !== null) {
						setDeepFhirPath(
							targetArray[i],
							segments.slice(),
							valueToSet,
							allSdElements,
							`${currentFullPathPrefix}[${i}]`,
						);
					}
				}
			}
		}
		return;
	}

	const currentObject = currentContextOrArray;
	const propertyName = segmentRaw; // Ex: "meta", "profile", "identifier", "type", "coding", "use"

	if (propertyName.startsWith('[?') && propertyName.endsWith(']')) {
		console.error(
			`[setValueByPath] Filter segment '${propertyName}' encountered in an object context. Path: ${currentFullPathPrefix}.${propertyName}. This may indicate an issue with path parsing or structure.`,
		);
		return;
	}

	const fullPathToProperty = currentFullPathPrefix
		? `${currentFullPathPrefix}.${propertyName}`
		: propertyName;

	if (remainingSegments.length === 0) {
		_.set(currentObject, propertyName, valueToSet);
	} else {
		if (
			!_.has(currentObject, propertyName) ||
			(typeof _.get(currentObject, propertyName) !== 'object' &&
				!Array.isArray(_.get(currentObject, propertyName)))
		) {
			const elementDefForProperty = findElementDefinitionByFullPath(
				fullPathToProperty,
				allSdElements,
			);
			let createAsArray = false;
			if (elementDefForProperty) {
				createAsArray =
					elementDefForProperty.max === '*' ||
					elementDefForProperty.max === null ||
					(elementDefForProperty.max != null &&
						Number.parseInt(elementDefForProperty.max, 10) > 1);
			} else {
				if (
					[
						'coding',
						'identifier',
						'extension',
						'name',
						'telecom',
						'contact',
						'entry',
						'link',
						'item',
						'profile',
					].includes(propertyName)
				) {
					createAsArray = true;
				}
				// console.warn(`[setValueByPath] SD element for '${fullPathToProperty}' not found. Defaulting structure for '${propertyName}' (array: ${createAsArray}).`);
			}
			_.set(currentObject, propertyName, createAsArray ? [] : {});
		}
		setDeepFhirPath(
			_.get(currentObject, propertyName),
			remainingSegments,
			valueToSet,
			allSdElements,
			fullPathToProperty,
		);
	}
}

export function setValue(
	obj: Record<string, unknown>,
	relativePath: string,
	value: any,
	allSdElements: SdElement[],
	resourceType: string,
): void {
	if (!obj || typeof obj !== 'object') {
		// console.error('[setValueByPath] Target object is invalid.');
		return;
	}
	if (typeof relativePath !== 'string' || !relativePath) {
		return;
	}

	const segments = parsePathSegments(relativePath);
	if (!segments || segments.length === 0) {
		if (
			!relativePath.includes('.') &&
			!relativePath.includes('[') &&
			relativePath.length > 0
		) {
			_.set(obj, relativePath, value);
		} else {
			// console.warn(`[setValueByPath] Path parser gave no segments for: '${relativePath}'.`);
		}
		return;
	}
	setDeepFhirPath(obj, segments, value, allSdElements, resourceType);
}
