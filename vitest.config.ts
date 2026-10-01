import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [{ find: /^@varia\/([\w-]+)$/, replacement: resolve('packages/$1/src/index.ts') }],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'spike/test/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    fileParallelism: false,
  },
})
