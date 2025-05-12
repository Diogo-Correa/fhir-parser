import { Direction, PrismaClient, SourceType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
	console.log('Start seeding ...');

	// URLs Canônicas (ajuste conforme necessário ou processe as SDs primeiro)
	const brCorePatientUrl = 'http://localhost:8080/fhir/StructureDefinition/1';
	const observationBaseUrl =
		'http://hl7.org/fhir/StructureDefinition/Observation';
	const administrativeGenderVs =
		'http://hl7.org/fhir/ValueSet/administrative-gender';

	await prisma.mappingConfiguration.upsert({
		where: { name: 'CsvToPatientBasic' },
		update: { structureDefinitionUrl: brCorePatientUrl },
		create: {
			name: 'CsvMapping',
			description: 'Maps a simple CSV to FHIR Patient resource',
			sourceType: SourceType.CSV,
			fhirResourceType: 'Patient',
			direction: Direction.TO_FHIR,
			structureDefinitionUrl: brCorePatientUrl,
			fieldMappings: {
				create: [
					{
						sourcePath: 'id_paciente',
						targetFhirPath: 'id',
						validationType: 'REQUIRED',
					},
					{
						sourcePath: 'nome_completo',
						targetFhirPath: 'name[0].text',
						validationType: 'MIN_LENGTH',
						validationDetails: { min: 3 },
					},
					{
						sourcePath: 'data_nascimento',
						targetFhirPath: 'birthDate',
						validationType: 'REGEX',
						validationDetails: {
							pattern: '^\\d{2}/\\d{2}/\\d{4}$',
							message: 'Formato esperado DD/MM/YYYY',
						},
						transformationType: 'FORMAT_DATE',
						transformationDetails: {
							inputFormat: 'dd/MM/yyyy',
							outputFormat: 'yyyy-MM-dd',
						},
					},
					{
						sourcePath: 'genero',
						targetFhirPath: 'gender', // Ex: M, F, I no CSV
						transformationType: 'CODE_LOOKUP',
						transformationDetails: {
							map: { M: 'male', F: 'female', I: 'other' },
							defaultValue: 'unknown',
						},
						validationType: 'VALUESET', // Valida o valor *transformado* (male, female, other, unknown)
						validationDetails: {
							valueSetUrl: administrativeGenderVs,
							strength: 'required',
						},
					},
					{
						sourcePath: 'cpf',
						targetFhirPath: 'identifier[0].value',
						validationType: 'REGEX',
						validationDetails: {
							pattern: '^\\d{11}$',
							message: 'CPF deve ter 11 dígitos',
						},
					},
				],
			},
		},
	});
	console.log('Upserted mapping: CsvToPatientBasic');

	await prisma.mappingConfiguration.upsert({
		where: { name: 'JsonToObservationVitals' },
		update: { structureDefinitionUrl: observationBaseUrl },
		create: {
			name: 'JsonToObservationVitals',
			description: 'Maps a simple JSON payload to FHIR Observation resource',
			sourceType: SourceType.JSON,
			fhirResourceType: 'Observation',
			direction: Direction.TO_FHIR,
			structureDefinitionUrl: observationBaseUrl,
			fieldMappings: {
				create: [
					{ sourcePath: 'vitalSign.id', targetFhirPath: 'id' },
					{ sourcePath: 'vitalSign.status', targetFhirPath: 'status' },
					{
						sourcePath: 'vitalSign.code',
						targetFhirPath: 'code.coding[0].code',
					},
					{
						sourcePath: 'vitalSign.display',
						targetFhirPath: 'code.coding[0].display',
					},
					{
						sourcePath: 'vitalSign.codeSystem',
						targetFhirPath: 'code.coding[0].system',
					},
					{
						sourcePath: 'vitalSign.value',
						targetFhirPath: 'valueQuantity.value',
					},
					{
						sourcePath: 'vitalSign.unit',
						targetFhirPath: 'valueQuantity.unit',
					},
					{
						sourcePath: 'vitalSign.valueSystem',
						targetFhirPath: 'valueQuantity.system',
					},
					{
						sourcePath: 'vitalSign.effectiveDateTime',
						targetFhirPath: 'effectiveDateTime',
					},
					{ sourcePath: 'patientId', targetFhirPath: 'subject.reference' },
				],
			},
		},
	});
	console.log('Upserted mapping: JsonToObservationVitals');

	// await prisma.mappingConfiguration.upsert({
	// 	where: { name: 'PatientToCsvBasic' },
	// 	update: { structureDefinitionUrl: brCorePatientUrl },
	// 	create: {
	// 		name: 'PatientToCsvBasic',
	// 		description: 'Maps FHIR Patient resources to a simple CSV',
	// 		sourceType: SourceType.CSV,
	// 		fhirResourceType: 'Patient',
	// 		direction: Direction.FROM_FHIR,
	// 		structureDefinitionUrl: brCorePatientUrl,
	// 		fieldMappings: {
	// 			create: [
	// 				{
	// 					targetFhirPath: 'id',
	// 					sourcePath: 'patient_identifier',
	// 					validationType: 'REQUIRED',
	// 				},
	// 				{
	// 					targetFhirPath: 'name[0].text',
	// 					sourcePath: 'full_name',
	// 					validationType: 'MIN_LENGTH',
	// 					validationDetails: { min: 3 },
	// 				},
	// 				{
	// 					targetFhirPath: 'birthDate',
	// 					sourcePath: 'dob',
	// 					validationType: 'REGEX',
	// 					validationDetails: {
	// 						pattern: '^\\d{2}/\\d{2}/\\d{4}$',
	// 						message: 'Formato esperado DD/MM/YYYY',
	// 					},
	// 					transformationType: 'FORMAT_DATE',
	// 					transformationDetails: {
	// 						inputFormat: 'dd/MM/yyyy',
	// 						outputFormat: 'yyyy-MM-dd',
	// 					},
	// 				},
	// 				{
	// 					targetFhirPath: 'gender',
	// 					sourcePath: 'sex',
	// 					transformationType: 'CODE_LOOKUP',
	// 					transformationDetails: {
	// 						map: { M: 'male', F: 'female', I: 'other' },
	// 						defaultValue: 'unknown',
	// 					},
	// 					validationType: 'VALUESET', // Valida o valor *transformado* (male, female, other, unknown)
	// 					validationDetails: {
	// 						valueSetUrl: administrativeGenderVs,
	// 						strength: 'required',
	// 					}, // Valida contra o ValueSet padrão FHIR
	// 				},
	// 				{
	// 					sourcePath: 'cpf',
	// 					targetFhirPath:
	// 						"identifier[?system='urn:oid:2.16.840.1.113883.13.236'].value", // Mapeando especificamente para o identificador CPF
	// 					validationType: 'REGEX',
	// 					validationDetails: {
	// 						pattern: '^\\d{11}$',
	// 						message: 'CPF deve ter 11 dígitos',
	// 					},
	// 					// Adicionar REQUIRED
	// 				},
	// 			],
	// 		},
	// 	},
	// });
	// console.log('Upserted mapping: PatientToCsvBasic');

	// // --- Mapeamento Observation -> JSON (FROM_FHIR) ---
	// // Valida os campos FHIR lidos contra Observation base
	// await prisma.mappingConfiguration.upsert({
	// 	where: { name: 'ObservationToJsonBasic' },
	// 	update: { structureDefinitionUrl: observationBaseUrl },
	// 	create: {
	// 		name: 'ObservationToJsonBasic',
	// 		description: 'Maps FHIR Observation resources to simple JSON objects',
	// 		sourceType: SourceType.JSON, // Target é JSON
	// 		fhirResourceType: 'Observation', // Source é Observation
	// 		direction: Direction.FROM_FHIR,
	// 		structureDefinitionUrl: observationBaseUrl, // Valida os paths FHIR lidos
	// 		fieldMappings: {
	// 			create: [
	// 				// targetFhirPath é relativo ao recurso Observation lido
	// 				{ targetFhirPath: 'id', sourcePath: 'obsId' }, // Gera campo obsId no JSON de saída
	// 				{ targetFhirPath: 'status', sourcePath: 'currentStatus' },
	// 				{
	// 					targetFhirPath: 'code.coding[0].code',
	// 					sourcePath: 'measurement.code',
	// 				},
	// 				{
	// 					targetFhirPath: 'code.coding[0].display',
	// 					sourcePath: 'measurement.name',
	// 				},
	// 				{ targetFhirPath: 'valueQuantity.value', sourcePath: 'result.value' },
	// 				{ targetFhirPath: 'valueQuantity.unit', sourcePath: 'result.units' },
	// 				{ targetFhirPath: 'effectiveDateTime', sourcePath: 'timestamp' },
	// 				{ targetFhirPath: 'subject.reference', sourcePath: 'patientRef' },
	// 			],
	// 		},
	// 	},
	// });
	// console.log('Upserted mapping: ObservationToJsonBasic');

	console.log('Seeding finished.');
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
