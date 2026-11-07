import {defineConfig, globalIgnores} from 'eslint/config'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default defineConfig([
  globalIgnores(['dist/**']),
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
    plugins: {'react-hooks': reactHooks},
    languageOptions: {globals: globals.browser},
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', {ignoreRestSiblings: true}],
    },
  },
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: {sourceType: 'commonjs', globals: globals.node},
  },
])
