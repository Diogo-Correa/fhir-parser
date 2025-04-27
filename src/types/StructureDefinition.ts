import type { FhirStructureDefinition } from '@prisma/client';

export type FhirStructureDefinitionWithPaths = FhirStructureDefinition & {
	elements: { path: string }[];
};
