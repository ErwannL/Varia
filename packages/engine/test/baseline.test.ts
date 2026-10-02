// Baseline (CDC §12) : options transmises au runner, filtres de targets, échecs honnêtes.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { planRun, runBaseline } from '../src/index.js'
import { context, FakeAdapter, observeRun, proc, scripted, type FakeTest } from './fake.js'

const TESTS: FakeTest[] = [
  { name: 'a', calls: [{ export: 'f', args: [{ name: 'Ada' }] }] },
  { name: 'b', calls: [{ export: 'g', args: ['x'] }] },
]

describe('baseline', () => {
  it('test.node_options transmis au runner', async () => {
    const adapter = scripted(TESTS)
    const ctx = context(adapter, "version: 1\ntest: { node_options: '--no-warnings' }\n")
    await runBaseline(ctx)
    ctx.close()
    expect(adapter.prepared[0]?.nodeOptions).toBe('--no-warnings')
  })
  it('targets.mode hybrid : les targets retirées ne sont jamais mutées', async () => {
    const ctx = context(
      scripted(TESTS),
      "version: 1\ntargets: { mode: hybrid, remove: ['g'] }\nmutations: { strategies: ['null'] }\n",
    )
    const b = await runBaseline(ctx)
    const s = planRun(ctx, b.runId)
    ctx.close()
    const plan = JSON.parse(readFileSync(s.planPath, 'utf8')) as { mutations: { export: string }[] }
    expect(plan.mutations.length).toBeGreaterThan(0)
    expect(new Set(plan.mutations.map((m) => m.export))).toEqual(new Set(['f']))
  })
  it('test en échec : BASELINE_FAILED (refusé, ou gardé sur demande), ou BASELINE_PARTIAL (partiel) avec force', async () => {
    const failing = [...TESTS, { name: 'rouge', status: 'failed' as const, calls: [] }]
    const ctx = context(scripted(failing))
    await expect(runBaseline(ctx)).rejects.toMatchObject({
      kind: 'BASELINE_FAILED',
      details: ['rouge'],
    })
    const kept = await runBaseline(ctx, { allowFailing: true })
    const forced = await runBaseline(ctx, { force: true })
    expect(kept.state).toBe('BASELINE_FAILED')
    expect(forced.state).toBe('BASELINE_PARTIAL')
    expect(ctx.reader.getRun(forced.runId)?.partial).toBe(true)
    ctx.close()
  })
  it('runner sans résultat après timeout : RUNNER_FAILURE qui le dit, run FAILED', async () => {
    const ctx = context(
      new FakeAdapter(() => ({
        ...observeRun([]),
        tests: null,
        process: proc({ exitCode: null, timedOut: true, stderr: 'trop long' }),
      })),
    )
    const e = await runBaseline(ctx).catch((x: unknown) => x)
    expect(e).toMatchObject({ kind: 'RUNNER_FAILURE', details: ['trop long'] })
    expect((e as Error).message).toContain('(code null, timeout)')
    expect(ctx.reader.listRuns(1)[0]?.state).toBe('FAILED')
    ctx.close()
  })
  it('sonde absente (aucun HELLO) : UNSUPPORTED_PROBE, run FAILED', async () => {
    const ctx = context(new FakeAdapter(() => observeRun(TESTS, { events: [] })))
    await expect(runBaseline(ctx)).rejects.toMatchObject({ kind: 'UNSUPPORTED_PROBE' })
    expect(ctx.reader.listRuns(1)[0]?.state).toBe('FAILED')
    ctx.close()
  })
})
