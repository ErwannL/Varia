// C-02 : la référence de comparaison est le dernier run COMPLET ; un run partiel ne conclut jamais FIXED
// hors de ce qu'il a exécuté.
import { describe, expect, it } from 'vitest'
import { planRun, runBaseline, runFuzz } from '../src/index.js'
import { context, scripted } from './fake.js'

const TESTS = [
  { name: 'a', calls: [{ export: 'f', args: [{ name: 'Ada' }] }] },
  { name: 'b', calls: [{ export: 'g', args: [7] }] },
]

describe('référence de comparaison (C-02)', () => {
  it('complet → partiel → complet : UNKNOWN dans le partiel, UNCHANGED ensuite (jamais REGRESSION)', async () => {
    const adapter = scripted(TESTS, (m) =>
      m.export === 'f' ? { throws: { name: 'TypeError', message: 'x' } } : { returns: 1 },
    )
    const ctx = context(
      adapter,
      "version: 1\nmutations: { seed: 2, per_input: 1, strategies: ['null'] }\n",
    )
    const runOnce = async (o: { maxTimeMs?: number } = {}) => {
      const b = await runBaseline(ctx)
      planRun(ctx, b.runId)
      await runFuzz(ctx, b.runId, o)
      return b.runId
    }
    const full1 = await runOnce()
    const [issue] = ctx.reader.issues(full1)
    expect(issue?.state).toBe('NEW')
    const partial = await runOnce({ maxTimeMs: 0 })
    expect(ctx.reader.getRun(partial)?.partial).toBe(true)
    expect(ctx.reader.issues(partial).find((i) => i.id === issue?.id)?.state).toBe('UNKNOWN')
    const full2 = await runOnce()
    expect(ctx.reader.getRun(full2)?.info['comparedTo']).toBe(full1)
    expect(ctx.reader.issues(full2).find((i) => i.id === issue?.id)?.state).toBe('UNCHANGED')
    ctx.close()
  })
})
