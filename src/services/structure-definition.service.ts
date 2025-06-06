import type { Prisma } from '@prisma/client';
import axios from 'axios';
import { findManyStructureDefinitions } from '../repositories/structure-definitions/find-many';
import { findUniqueStructureDefinitionByUrlOrType } from '../repositories/structure-definitions/find-unique-sd';
import { fhirStructureDefinitionTransaction } from '../repositories/structure-definitions/transaction';
import { FhirClientError } from './errors/FhirClientError';

const DEFAULT_FHIR_SERVER_URL =
	process.env.FHIR_SERVER_BASE_URL || 'http://localhost:8080/fhir';

interface ProcessResult {
	success: boolean;
	message: string;
	structureDefinitionId?: string;
	elementCount?: number;
	structureDefinitionUrl?: string;
}

export async function getAllStructureDefinitions() {
	const structureDefinitions = await findManyStructureDefinitions();
	return structureDefinitions;
}

export async function getStructureDefinitionByUrlOrType(
	url?: string | null,
	type?: string | null,
) {
	const structureDefinition = await findUniqueStructureDefinitionByUrlOrType(
		url,
		type,
	);
	return structureDefinition;
}

export async function processAndStoreStructureDefinition(
	identifier: string,
	fhirServerUrl?: string,
): Promise<ProcessResult> {
	const serverUrl = fhirServerUrl || DEFAULT_FHIR_SERVER_URL;
	let structureDefinition: any;
	let fetchUrl = ''; // Para logging de erro

	try {
		// Tenta buscar por ID ou URL canônica
		if (identifier.includes('/')) {
			// Heurística: Se tem /, provavelmente é URL ou tipo/id
			if (identifier.startsWith('https') || identifier.startsWith('http')) {
				// URL Canônica
				fetchUrl = `${serverUrl}/StructureDefinition?url=${encodeURIComponent(identifier)}`;
			} else {
				// tipo/id (ex: Patient/br-core-patient) - pode não funcionar em todos os servidores
				fetchUrl = `${serverUrl}/${identifier}`; // Assumindo StructureDefinition/id
				if (!identifier.startsWith('StructureDefinition/')) {
					fetchUrl = `${serverUrl}/StructureDefinition/${identifier}`;
				}
			}
		} else {
			// Assume ID lógico
			fetchUrl = `${serverUrl}/StructureDefinition/${identifier}`;
		}

		console.log(`Attempting to fetch StructureDefinition using: ${fetchUrl}`);
		const response = await axios.get(fetchUrl, {
			headers: { Accept: 'application/fhir+json' },
			timeout: 30000,
		});

		// Trata Bundle ou Recurso único
		if (response.data?.resourceType === 'Bundle') {
			if (
				response.data.entry?.length > 0 &&
				response.data.entry[0].resource?.resourceType === 'StructureDefinition'
			) {
				structureDefinition = response.data.entry[0].resource;
			} else {
				throw new Error(
					`Bundle received from ${fetchUrl}, but no StructureDefinition found in the first entry.`,
				);
			}
		} else if (response.data?.resourceType === 'StructureDefinition') {
			structureDefinition = response.data;
		} else {
			throw new Error(
				`Unexpected response received from ${fetchUrl}: ${JSON.stringify(response.data)}`,
			);
		}

		if (!structureDefinition?.url) {
			console.error(
				'Fetched resource is missing a canonical URL.',
				structureDefinition,
			);
			throw new Error(
				`Workspaceed resource from ${fetchUrl} is not a valid StructureDefinition (missing URL).`,
			);
		}
		console.log(
			`Successfully fetched StructureDefinition: ${structureDefinition.url} (version: ${structureDefinition.version})`,
		);

		// Prioriza snapshot, fallback para differential
		const elements =
			structureDefinition.snapshot?.element ??
			structureDefinition.differential?.element;
		if (!Array.isArray(elements) || elements.length === 0) {
			return {
				success: false,
				message: `StructureDefinition ${structureDefinition.url} has no snapshot or differential elements.`,
			};
		}

		// Prepara dados para upsert
		const sdData: Prisma.FhirStructureDefinitionCreateInput = {
			url: structureDefinition.url,
			version: structureDefinition.version,
			name: structureDefinition.name,
			type: structureDefinition.type,
			fhirVersion: structureDefinition.fhirVersion,
			description: structureDefinition.description,
		};

		const elementsData: Omit<
			Prisma.FhirElementDefinitionCreateManyInput,
			'structureDefinitionId'
		>[] = [];
		for (const element of elements) {
			if (!element.path) continue;
			let fixedValue: string | null = null;
			let fixedValueType: string | null = null;
			let defaultValue: string | null = null;
			let defaultValueType: string | null = null;

			for (const key in element) {
				if (key.startsWith('fixed') && element[key] !== undefined) {
					fixedValueType = key.substring(5);
					// Trata objetos/arrays no valor fixo (ex: codeableConcept) como JSON string
					fixedValue =
						typeof element[key] === 'object'
							? JSON.stringify(element[key])
							: String(element[key]);
					break;
				}
			}
			for (const key in element) {
				if (key.startsWith('defaultValue') && element[key] !== undefined) {
					defaultValueType = key.substring(12);
					defaultValue =
						typeof element[key] === 'object'
							? JSON.stringify(element[key])
							: String(element[key]);
					break;
				}
			}

			elementsData.push({
				path: element.path,
				sliceName: element.sliceName,
				shortDescription: element.short,
				definition: element.definition,
				dataTypes: element.type?.map((t: any) => t.code).filter(Boolean) ?? [],
				cardinalityMin: element.min,
				cardinalityMax: element.max,
				fixedValue: fixedValue,
				fixedValueType: fixedValueType?.toLowerCase(),
				defaultValue: defaultValue,
				defaultValueType: defaultValueType?.toLowerCase(),
			});
		}

		// Transação no DB
		try {
			const savedStructureDefinition = await fhirStructureDefinitionTransaction(
				sdData.url,
				sdData,
				elementsData,
			);

			console.log(
				`StructureDefinition ${savedStructureDefinition.url} and ${elementsData.length} elements stored.`,
			);
			return {
				success: true,
				message: `StructureDefinition ${savedStructureDefinition.url} processed and stored.`,
				structureDefinitionId: savedStructureDefinition.id,
				structureDefinitionUrl: savedStructureDefinition.url, // Retorna a URL
				elementCount: elementsData.length,
			};
		} catch (dbError: any) {
			console.error(
				`Error saving StructureDefinition ${sdData.url} to database:`,
				dbError,
			);
			throw new Error(
				`Database error while saving ${sdData.url}: ${dbError.message}`,
			); // Re-throw para ser pego pelo catch externo
		}
	} catch (error: any) {
		let errorMessage = `Failed to process StructureDefinition '${identifier}'. URL tried: ${fetchUrl}.`;
		if (error instanceof FhirClientError) {
			// Se for erro do nosso cliente
			errorMessage = error.message; // Já formatado
		} else if (axios.isAxiosError(error)) {
			const status = error.response?.status;
			`${errorMessage} Status: ${status}.`;
			if (status === 404) {
				`${errorMessage} Resource not found.`;
			} else {
				`${errorMessage} Response: ${JSON.stringify(error.response?.data)}`;
			}
		} else {
			`${errorMessage} Error: ${error.message}`;
		}
		console.error(errorMessage);
		// Retorna falha, mas não lança erro para o controller necessariamente
		return { success: false, message: errorMessage };
	}
}
