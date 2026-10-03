// La suite de conformité (CDC §9.3) contre les adapters RÉELS, Jest et Vitest, pilotés par le moteur.
import { runConformance } from '@varia/adapter-conformance'
import { JestAdapter } from '@varia/adapter-jest'
import { VitestAdapter } from '@varia/adapter-vitest'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('conformité des adapters livrés', () => {
  it('Jest (CommonJS) passe toutes les vérifications', async () => {
    const r = await runConformance({
      adapter: new JestAdapter(),
      example: resolve('examples/jest-project'),
      dialect: { module: 'cjs', ext: 'js' },
    })
    expect(r.checks.filter((c) => c.status !== 'PASS')).toEqual([])
  })
  it('Vitest (ESM, TypeScript) passe toutes les vérifications', async () => {
    const r = await runConformance({
      adapter: new VitestAdapter(),
      example: resolve('examples/vitest-project'),
      dialect: { module: 'esm', ext: 'ts', testImport: "import { expect, test } from 'vitest'" },
    })
    expect(r.checks.filter((c) => c.status !== 'PASS')).toEqual([])
  })
})
