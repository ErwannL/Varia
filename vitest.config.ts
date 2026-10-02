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
    setupFiles: ['tests/setup/child-coverage.ts'],
    coverage: {
      provider: 'v8',
      experimentalAstAwareRemapping: true,
      reporter: ['text-summary', 'json'],
      reportsDirectory: 'coverage',
      // Tout le code livré des paquets est mesuré (politique J3, docs/notes/couverture.md). Les seuils
      // et les exclusions motivées vivent dans coverage-thresholds.json, jugés EXACTEMENT par
      // scripts/check-coverage-exact.mjs après fusion de la couverture des processus enfants.
      include: ['packages/**/src/**', 'packages/**/runtime/**'],
      exclude: ['**/*.d.ts', '**/README.md', '**/test/**', '**/node_modules/**', '**/dist/**'],
    },
    fileParallelism: false,
  },
})
