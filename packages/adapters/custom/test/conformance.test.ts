// Suite de conformité d'adaptateur (CDC §9.3) contre l'adaptateur custom RÉEL branché sur le lanceur
// factice de examples/custom-project (runner.cjs), qui implémente lui-même le protocole sans rien
// importer de Varia. Les fichiers de conformité (`test`, `test.each`, `expect`) sont les globaux du
// lanceur : dialecte CommonJS sans import.
import { runConformance } from '@varia/adapter-conformance'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CustomAdapter } from '../src/index.js'

describe('conformité de l’adaptateur custom', () => {
  it('le lanceur factice passe toutes les vérifications', async () => {
    const r = await runConformance({
      adapter: new CustomAdapter({
        command: ['node', 'runner.cjs'],
        capabilities: { observation: true, argumentMutation: true, perTestSelection: true },
      }),
      example: resolve('examples/custom-project'),
      dialect: { module: 'cjs', ext: 'js' },
    })
    expect(r.checks.filter((c) => c.status !== 'PASS')).toEqual([])
    expect(r.checks).toHaveLength(9)
  })
})
