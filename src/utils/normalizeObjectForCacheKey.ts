export function sortObjectKeysRecursively(obj: any): any {
	if (Array.isArray(obj)) {
		return obj.map(sortObjectKeysRecursively);
	}
	if (typeof obj === 'object' && obj !== null) {
		const newObj: { [key: string]: any } = {};
		// biome-ignore lint/complexity/noForEach: <explanation>
		Object.keys(obj)
			.sort()
			.forEach((key) => {
				newObj[key] = sortObjectKeysRecursively(obj[key]);
			});
		return newObj;
	}
	return obj;
}

export function normalizeDataArrayForCache(dataArray: any[]): any[] {
	if (!Array.isArray(dataArray)) {
		return dataArray; // Retorna como está se não for um array
	}

	// 1. Normaliza as chaves de cada objeto dentro do array
	const normalizedKeyObjects = dataArray.map((item) =>
		sortObjectKeysRecursively(item),
	);

	// 2. Ordena o array de objetos normalizados.
	//    Você precisa definir um critério de ordenação estável.
	//    Exemplo: Ordenar por 'pacienteIdInterno' se existir, ou por uma string JSON do objeto.
	//    Usar JSON.stringify de cada objeto (já com chaves ordenadas) para a ordenação do array
	//    é uma forma genérica de garantir uma ordem canônica para o array.
	return normalizedKeyObjects.sort((a, b) => {
		// Para uma ordenação canônica consistente, comparamos as strings JSON dos objetos
		// (que já tiveram suas chaves internas ordenadas).
		const stringA = JSON.stringify(a);
		const stringB = JSON.stringify(b);
		if (stringA < stringB) return -1;
		if (stringA > stringB) return 1;
		return 0;
	});
}
