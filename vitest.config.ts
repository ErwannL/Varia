import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@varia\/adapter-jest$/,
        replacement: resolve('packages/adapters/jest/src/index.ts'),
      },
      {
        find: /^@varia\/adapter-vitest$/,
        replacement: resolve('packages/adapters/vitest/src/index.ts'),
      },
      { find: /^@varia\/([\w-]+)$/, replacement: resolve('packages/$1/src/index.ts') },
    ],
  },
  esbuild: { jsx: 'automatic' },
  test: {
    include: [
      'packages/dashboard/test/**/*.test.tsx',
      'packages/*/test/**/*.test.ts',
      'packages/adapters/*/test/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'packages/*/src/**',
        'packages/adapters/*/src/**',
        'packages/probe-runtime/runtime/serialize.cjs',
      ],
      // Exécutés HORS du processus Vitest (dans Jest ou en sous-processus) : non mesurables par v8 ici,
      // couverts par les tests d'intégration (docs/notes/couverture.md). Points d'entrée sans logique.
      // Seuils PAR FICHIER, par axe (lignes, branches, fonctions, instructions), versionnés en J1 :
      // on ne les baisse JAMAIS, on ajoute des tests (règle qualité n°11, docs/notes/couverture.md).
      thresholds: {
        perFile: true,
        'packages/adapters/jest/**': { lines: 91, branches: 76, functions: 100, statements: 91 },
        'packages/adapters/vitest/**': { lines: 93, branches: 76, functions: 100, statements: 93 },
        'packages/api/**': { lines: 93, branches: 84, functions: 75, statements: 93 },
        'packages/cli/**': { lines: 88, branches: 78, functions: 71, statements: 88 },
        'packages/config/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'packages/core/**': { lines: 96, branches: 86, functions: 100, statements: 96 },
        'packages/dashboard/**': { lines: 80, branches: 47, functions: 63, statements: 80 },
        'packages/database/**': { lines: 100, branches: 95, functions: 100, statements: 100 },
        'packages/engine/**': { lines: 91, branches: 50, functions: 87, statements: 91 },
        'packages/i18n/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
        'packages/probe-protocol/**': {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
        'packages/probe-runtime/**': { lines: 88, branches: 80, functions: 82, statements: 88 },
        'packages/reporters/**': { lines: 100, branches: 77, functions: 100, statements: 100 },
        'packages/testkit/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
      exclude: [
        'packages/cli/src/main.ts',
        'packages/*/src/write-schema.ts',
        'packages/dashboard/src/main.tsx',
        '**/*.d.ts',
      ],
    },
    fileParallelism: false,
  },
})
