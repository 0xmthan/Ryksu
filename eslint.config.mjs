import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['.vite/', '.webpack/', 'out/', 'src/.vite/', 'src/generated/', 'scripts/vendor/'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // TypeScript already reports undefined names, with the right globals for each file.
      'no-undef': 'off',
      // `catch {}` is how a failure that doesn't matter gets ignored.
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.tsx'],
    plugins: react.configs.flat.recommended.plugins,
    languageOptions: react.configs.flat.recommended.languageOptions,
    rules: { ...react.configs.flat.recommended.rules, ...react.configs.flat['jsx-runtime'].rules },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    // The classic hook rules. The React Compiler rules v7 adds (refs, set-state-in-effect, …) flag patterns
    // the 3D view relies on; adopting them is its own refactor.
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    // Build scripts and configs that stay plain JavaScript (CommonJS).
    files: ['**/*.{js,cjs}'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  prettier
)
