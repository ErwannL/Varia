import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'coverage/**', 'examples/**', 'docs/**'],
  },
  {
    // Aucun dialogue natif du navigateur dans le dashboard (prompt §4.4).
    files: ['packages/dashboard/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': ['error', 'alert', 'confirm', 'prompt'],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'alert' },
        { object: 'window', property: 'confirm' },
        { object: 'window', property: 'prompt' },
        { object: 'Math', property: 'random', message: 'Utiliser mulberry32 (CDC B).' },
      ],
    },
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Utiliser mulberry32 (CDC B).' },
      ],
    },
  },
  {
    files: ['scripts/dashboard-check.mjs', 'packages/dashboard/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
