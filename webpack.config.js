const path = require('node:path');

module.exports = {
	mode: 'production',
	entry: {
		k6test: './tests/k6/main.js',
	},
	output: {
		path: path.resolve(__dirname, 'dist_k6'),
		filename: '[name].bundle.js',
		libraryTarget: 'commonjs',
	},
	module: {
		rules: [
			{
				test: /\.js$/,
				exclude: /node_modules/,
				use: {
					loader: 'babel-loader',
					options: {
						presets: ['@babel/preset-env'],
					},
				},
			},
		],
	},
	target: 'node',
	externals: {
		k6: 'commonjs k6',
		'k6/http': 'commonjs k6/http',
		'k6/metrics': 'commonjs k6/metrics',
		'k6/data': 'commonjs k6/data',
	},
	stats: {
		colors: true,
	},
};
