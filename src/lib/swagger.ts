export const swagger = {
	openapi: {
		openapi: '3.0.0',
		info: {
			title: 'FHIR Parser - Documentação',
			description: 'Documentação de endpoints da API',
			version: '1.0.0',
			contact: {
				name: 'Diogo Correa',
				email: 'diogocorrea@id.uff.br',
			},
		},
		servers: [
			{
				url: process.env.DOCS_SERVER_URL || 'http://localhost:3333',
				description: process.env.DOCS_SERVER_NAME || 'Desenvolvimento',
			},
		],
		tags: [],
		components: {},
	},
};
