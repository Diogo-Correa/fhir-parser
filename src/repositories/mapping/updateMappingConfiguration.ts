import type { Prisma } from '@prisma/client';
import { db } from '../../lib/prisma';

export async function updateMappingConfigurationWithFields(
	identifier: string,
	configUpdateData: Prisma.MappingConfigurationUpdateInput,
	newFieldMappingsData?: Omit<
		Prisma.FieldMappingCreateManyInput,
		'mappingConfigurationId'
	>[],
) {
	const isCUID = /^[c][^\\s-]{24}$/.test(identifier);
	const whereClause = isCUID ? { id: identifier } : { name: identifier };

	return db.$transaction(async (tx) => {
		const existingConfig = await tx.mappingConfiguration.findUnique({
			where: whereClause,
			select: { id: true },
		});

		if (!existingConfig) {
			throw new Error(
				`MappingConfiguration with identifier '${identifier}' not found for update.`,
			);
		}
		const configId = existingConfig.id;

		const { fieldMappings, ...prismaConfigUpdateData } =
			configUpdateData as any;
		await tx.mappingConfiguration.update({
			where: { id: configId },
			data: prismaConfigUpdateData,
		});

		if (newFieldMappingsData !== undefined) {
			await tx.fieldMapping.deleteMany({
				where: { mappingConfigurationId: configId },
			});

			if (newFieldMappingsData.length > 0) {
				await tx.fieldMapping.createMany({
					data: newFieldMappingsData.map((fm) => ({
						...fm,
						mappingConfigurationId: configId,
					})),
				});
			}
		}

		return tx.mappingConfiguration.findUniqueOrThrow({
			where: { id: configId },
			include: { fieldMappings: true },
		});
	});
}
