import type {
	FhirElementDefinition,
	FhirStructureDefinition,
} from '@prisma/client';

export type FhirStructureDefinitionWithPaths = FhirStructureDefinition & {
	elements: FhirElementDefinition[];
};
