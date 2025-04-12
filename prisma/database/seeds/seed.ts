import { Direction, SourceType } from '@prisma/client';
import { db } from '../../../src/lib/prisma';

async function main() {
	console.log('Start seeding ...');

	// Exemplo: Mapeamento de um CSV simples para Recurso Patient FHIR
	const csvToPatient = await db.mappingConfiguration.upsert({
		where: { name: 'CsvToPatientBasic' },
		update: {},
		create: {
			name: 'CsvToPatientBasic',
			description: 'Maps a simple CSV to FHIR Patient resource',
			sourceType: SourceType.CSV,
			fhirResourceType: 'Patient',
			direction: Direction.TO_FHIR,
			fieldMappings: {
				create: [
					{ sourcePath: 'id_paciente', targetFhirPath: 'Patient.id' }, // Mapeia coluna 'id_paciente' para Patient.id
					{
						sourcePath: 'nome_completo',
						targetFhirPath: 'Patient.name[0].text',
					}, // Mapeia 'nome_completo' para o texto do primeiro nome
					{
						sourcePath: 'data_nascimento',
						targetFhirPath: 'Patient.birthDate',
					}, // Mapeia 'data_nascimento' para data de nascimento
					{ sourcePath: 'genero', targetFhirPath: 'Patient.gender' }, // Mapeia 'genero' para Patient.gender
				],
			},
		},
	});
	console.log(
		`Created mapping configuration with id: ${csvToPatient.id} and name: ${csvToPatient.name}`,
	);

	// Exemplo: Mapeamento de JSON para Observation FHIR
	const jsonToObservation = await db.mappingConfiguration.upsert({
		where: { name: 'JsonToObservationVitals' },
		update: {},
		create: {
			name: 'JsonToObservationVitals',
			description:
				'Maps a simple JSON payload to FHIR Observation resource for vital signs',
			sourceType: SourceType.JSON,
			fhirResourceType: 'Observation',
			direction: Direction.TO_FHIR,
			fieldMappings: {
				create: [
					{ sourcePath: 'vitalSign.id', targetFhirPath: 'Observation.id' },
					{
						sourcePath: 'vitalSign.status',
						targetFhirPath: 'Observation.status',
					}, // ex: 'final'
					{
						sourcePath: 'vitalSign.code',
						targetFhirPath: 'Observation.code.coding[0].code',
					}, // ex: '8480-6' (LOINC para Pressão Sistólica)
					{
						sourcePath: 'vitalSign.display',
						targetFhirPath: 'Observation.code.coding[0].display',
					}, // ex: 'Systolic blood pressure'
					{
						sourcePath: 'vitalSign.value',
						targetFhirPath: 'Observation.valueQuantity.value',
					}, // ex: 120
					{
						sourcePath: 'vitalSign.unit',
						targetFhirPath: 'Observation.valueQuantity.unit',
					}, // ex: 'mmHg'
					{
						sourcePath: 'vitalSign.system',
						targetFhirPath: 'Observation.valueQuantity.system',
					}, // ex: 'http://unitsofmeasure.org'
					{
						sourcePath: 'vitalSign.effectiveDateTime',
						targetFhirPath: 'Observation.effectiveDateTime',
					},
					{
						sourcePath: 'patientId',
						targetFhirPath: 'Observation.subject.reference',
					}, // ex: 'Patient/123'
				],
			},
		},
	});
	console.log(`Created mapping configuration with id: ${jsonToObservation.id}`);

	console.log('Seeding finished.');
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await db.$disconnect();
	});
