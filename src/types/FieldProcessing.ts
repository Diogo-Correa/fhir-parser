export interface FieldProcessingError {
	fieldSourcePath?: string; // Qual campo de origem falhou
	fieldTargetPath: string; // Qual campo de destino foi afetado
	inputValue: any; // O valor que causou o erro
	errorType: 'Validation' | 'Transformation'; // Tipo do erro
	message: string; // Mensagem descritiva do erro
	details?: any; // Detalhes da regra que falhou (opcional)
}
