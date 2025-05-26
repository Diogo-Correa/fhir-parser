import { textSummary } from 'k6/metrics';

export function generateSummaryReport(data) {
	console.log('Generating Test Execution Summary...');

	const summaryData = {
		'summary_report.json': JSON.stringify(data),
		stdout: textSummary(data, { indent: '  ', enableColors: true }),
	};
	// ...
	return summaryData;
}
