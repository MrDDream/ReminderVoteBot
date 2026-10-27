import js from '@eslint/js';
import globals from 'globals';

export default [
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: globals.node
		},
		rules: {
			'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			eqeqeq: 'error',
			'prefer-const': 'error',
			'no-var': 'error',
			'object-shorthand': 'error',
			'no-console': 'off'
		}
	}
];
