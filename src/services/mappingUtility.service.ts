import type { FieldMapping } from '@prisma/client';
import { Direction, SourceType, TransformationType } from '@prisma/client';
import type { ValidateMappingConfigurationDryRunInput } from '../schemas/mappingUtility.schema';
import {
	transformationRegistry,
	validationRegistry,
} from '../utils/transformation';
import { validateMappingAgainstStructureDefinition } from './mapping.service';

export function getAvailableTransformationTypesService(): string[] {
	return Array.from(transformationRegistry.keys());
}

export function getAvailableValidationTypesService(): string[] {
	return Array.from(validationRegistry.keys());
}

export async function validateMappingConfigurationDryRunService(
	input: ValidateMappingConfigurationDryRunInput,
): Promise<{
	success: boolean;
	message: string;
	issues?: Array<{ path?: string; message: string }>;
}> {
	try {
		const direction = Direction[input.direction as keyof typeof Direction];
		const sourceType = SourceType[input.sourceType as keyof typeof SourceType];

		if (!direction) {
			return {
				success: false,
				message: `Invalid direction: ${input.direction}`,
			};
		}
		if (!sourceType) {
			return {
				success: false,
				message: `Invalid sourceType: ${input.sourceType}`,
			};
		}

		const fieldMappingsForValidation: Array<
			Pick<
				FieldMapping,
				'targetFhirPath' | 'transformationType' | 'transformationDetails'
			>
		> = input.fieldMappings.map((fm) => {
			let validTransformationType: TransformationType | null = null;
			if (fm.transformationType) {
				if (
					!Object.values(TransformationType).includes(
						fm.transformationType as TransformationType,
					)
				) {
					throw new Error(
						`Invalid transformationType: ${fm.transformationType} for field ${fm.targetFhirPath}`,
					);
				}
				validTransformationType = fm.transformationType as TransformationType;
			}

			return {
				targetFhirPath: fm.targetFhirPath,
				transformationType: validTransformationType,
				transformationDetails: fm.transformationDetails as any,
			};
		});

		await validateMappingAgainstStructureDefinition(
			input.name,
			input.fhirResourceType,
			input.structureDefinitionUrl,
			fieldMappingsForValidation,
			direction,
		);
		return { success: true, message: 'Mapping configuration is valid.' };
	} catch (error: any) {
		return {
			success: false,
			message: error.message || 'Validation failed due to an unexpected error.',
			issues: error.invalidPath
				? [{ path: error.invalidPath, message: error.message }]
				: undefined,
		};
	}
}
