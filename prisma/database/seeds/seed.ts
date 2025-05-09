import { Direction, PrismaClient, SourceType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
	console.log('Start seeding ...');

	// URLs Canônicas (ajuste conforme necessário ou processe as SDs primeiro)
	const brCorePatientUrl =
		'https://br-core.saude.gov.br/fhir/StructureDefinition/br-core-patient';
	const observationBaseUrl =
		'http://hl7.org/fhir/StructureDefinition/Observation';
	const administrativeGenderVs =
		'http://hl7.org/fhir/ValueSet/administrative-gender';

	// --- Mapeamento CSV -> Patient (TO_FHIR) ---
	// Validado contra br-core-patient OU Patient base se br-core não processado
	await prisma.mappingConfiguration.upsert({
		where: { name: 'CsvToPatientBasic' },
		update: { structureDefinitionUrl: brCorePatientUrl }, // Tenta validar contra o perfil BR
		create: {
			name: 'CsvToPatientBasic',
			description: 'Maps a simple CSV to FHIR Patient resource',
			sourceType: SourceType.CSV,
			fhirResourceType: 'Patient',
			direction: Direction.TO_FHIR,
			structureDefinitionUrl: brCorePatientUrl, // Especifica contra qual SD validar
			fieldMappings: {
				create: [
					// ID: Obrigatório e talvez um formato específico
					{
						sourcePath: 'id_paciente',
						targetFhirPath: 'id',
						validationType: 'REQUIRED', // Garante que não seja vazio/nulo
					},
					// Nome: Obrigatório, mínimo de 3 caracteres
					{
						sourcePath: 'nome_completo',
						targetFhirPath: 'name[0].text',
						validationType: 'MIN_LENGTH',
						validationDetails: { min: 3 },
					},
					// Data Nascimento: Obrigatório, formato específico e transformação
					{
						sourcePath: 'data_nascimento',
						targetFhirPath: 'birthDate',
						validationType: 'REGEX',
						validationDetails: {
							pattern: '^\\d{2}/\\d{2}/\\d{4}$',
							message: 'Formato esperado DD/MM/YYYY',
						}, // Valida formato de entrada
						transformationType: 'FORMAT_DATE',
						transformationDetails: {
							inputFormat: 'dd/MM/yyyy',
							outputFormat: 'yyyy-MM-dd',
						},
						// Adicionar REQUIRED se necessário
					},
					// Gênero: Mapeamento de código e validação contra ValueSet
					{
						sourcePath: 'genero_csv',
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
						}, // Valida contra o ValueSet padrão FHIR
					},
					// CPF: Obrigatório e valida formato (regex simples, pode melhorar)
					{
						sourcePath: 'cpf',
						targetFhirPath:
							"identifier[?system='urn:oid:2.16.840.1.113883.13.236'].value", // Mapeando especificamente para o identificador CPF
						validationType: 'REGEX',
						validationDetails: {
							pattern: '^\\d{11}$',
							message: 'CPF deve ter 11 dígitos',
						},
						// Adicionar REQUIRED
					},
				],
			},
		},
	});
	console.log('Upserted mapping: CsvToPatientBasic');

	// --- Mapeamento JSON -> Observation (TO_FHIR) ---
	// Validado contra a Observation base
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
					// Paths relativos à raiz da Observation
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
					}, // Ex: 'http://loinc.org'
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
					}, // Ex: 'http://unitsofmeasure.org'
					{
						sourcePath: 'vitalSign.effectiveDateTime',
						targetFhirPath: 'effectiveDateTime',
					},
					{ sourcePath: 'patientId', targetFhirPath: 'subject.reference' }, // Ex: 'Patient/123'
				],
			},
		},
	});
	console.log('Upserted mapping: JsonToObservationVitals');

	// --- Mapeamento Patient -> CSV (FROM_FHIR) ---
	// Valida os campos FHIR lidos contra br-core-patient OU Patient base
	await prisma.mappingConfiguration.upsert({
		where: { name: 'PatientToCsvBasic' },
		update: { structureDefinitionUrl: brCorePatientUrl },
		create: {
			name: 'PatientToCsvBasic',
			description: 'Maps FHIR Patient resources to a simple CSV',
			sourceType: SourceType.CSV, // Target é CSV
			fhirResourceType: 'Patient', // Source é Patient
			direction: Direction.FROM_FHIR,
			structureDefinitionUrl: brCorePatientUrl, // Valida os paths FHIR lidos
			fieldMappings: {
				create: [
					// targetFhirPath é relativo ao recurso Patient lido
					{
						targetFhirPath: 'id',
						sourcePath: 'patient_identifier',
						validationType: 'REQUIRED',
					},
					{
						targetFhirPath: 'name[0].text',
						sourcePath: 'full_name',
						validationType: 'MIN_LENGTH',
						validationDetails: { min: 3 },
					},
					{
						targetFhirPath: 'birthDate',
						sourcePath: 'dob',
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
						targetFhirPath: 'gender',
						sourcePath: 'sex',
						transformationType: 'CODE_LOOKUP',
						transformationDetails: {
							map: { M: 'male', F: 'female', I: 'other' },
							defaultValue: 'unknown',
						},
						validationType: 'VALUESET', // Valida o valor *transformado* (male, female, other, unknown)
						validationDetails: {
							valueSetUrl: administrativeGenderVs,
							strength: 'required',
						}, // Valida contra o ValueSet padrão FHIR
					},
					{
						sourcePath: 'cpf',
						targetFhirPath:
							"identifier[?system='urn:oid:2.16.840.1.113883.13.236'].value", // Mapeando especificamente para o identificador CPF
						validationType: 'REGEX',
						validationDetails: {
							pattern: '^\\d{11}$',
							message: 'CPF deve ter 11 dígitos',
						},
						// Adicionar REQUIRED
					},
				],
			},
		},
	});
	console.log('Upserted mapping: PatientToCsvBasic');

	// --- Mapeamento Observation -> JSON (FROM_FHIR) ---
	// Valida os campos FHIR lidos contra Observation base
	await prisma.mappingConfiguration.upsert({
		where: { name: 'ObservationToJsonBasic' },
		update: { structureDefinitionUrl: observationBaseUrl },
		create: {
			name: 'ObservationToJsonBasic',
			description: 'Maps FHIR Observation resources to simple JSON objects',
			sourceType: SourceType.JSON, // Target é JSON
			fhirResourceType: 'Observation', // Source é Observation
			direction: Direction.FROM_FHIR,
			structureDefinitionUrl: observationBaseUrl, // Valida os paths FHIR lidos
			fieldMappings: {
				create: [
					// targetFhirPath é relativo ao recurso Observation lido
					{ targetFhirPath: 'id', sourcePath: 'obsId' }, // Gera campo obsId no JSON de saída
					{ targetFhirPath: 'status', sourcePath: 'currentStatus' },
					{
						targetFhirPath: 'code.coding[0].code',
						sourcePath: 'measurement.code',
					},
					{
						targetFhirPath: 'code.coding[0].display',
						sourcePath: 'measurement.name',
					},
					{ targetFhirPath: 'valueQuantity.value', sourcePath: 'result.value' },
					{ targetFhirPath: 'valueQuantity.unit', sourcePath: 'result.units' },
					{ targetFhirPath: 'effectiveDateTime', sourcePath: 'timestamp' },
					{ targetFhirPath: 'subject.reference', sourcePath: 'patientRef' },
				],
			},
		},
	});
	console.log('Upserted mapping: ObservationToJsonBasic');

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
