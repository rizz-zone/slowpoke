import prettier from 'eslint-config-prettier'
import js from '@eslint/js'
import { includeIgnoreFile } from '@eslint/compat'
import globals from 'globals'
import { fileURLToPath, URL } from 'node:url'
import ts from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url))

export default ts.config(
	includeIgnoreFile(gitignorePath, 'Imported gitignore file'),
	js.configs.recommended,
	...ts.configs.strict,
	prettier,
	{
		languageOptions: {
			globals: { ...globals.serviceworker, ...globals.worker }
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_'
				}
			]
		}
	},
	globalIgnores(['**/worker-configuration.d.ts'])
)
