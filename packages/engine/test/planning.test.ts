import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mutationTimeoutMs, planRun, runBaseline, runFuzz } from '../src/index.js'
import { context, FakeAdapter, fuzzRun, observeRun } from './fake.js'

const TESTS = [{ name: 'crée', calls: [{ args: [{ name: 'Ada', age: 3 }] }] }]

describe('plan (CDC §14.1, A-09)', () => {
  it('porte le commit git ; deux environnements différents donnent le MÊME plan', async () => {
    const adapter = new FakeAdapter(() => observeRun(TESTS))
    const ctx = context(adapter, 'version: 1\nmutations: { seed: 7 }\n')
    const a = await runBaseline(ctx)
    const b = await runBaseline(ctx)
    // Autre machine, autre Node : empreinte d'environnement différente pour le second run.
    ctx.db.sqlite
      .prepare('UPDATE runs SET env_hash = ?, git_commit = ? WHERE id = ?')
      .run('autre', null, b.runId)
    ctx.db.sqlite.prepare('UPDATE runs SET git_commit = ? WHERE id = ?').run(null, a.runId)
    const pa = readFileSync(planRun(ctx, a.runId).planPath)
    const pb = readFileSync(planRun(ctx, b.runId).planPath)
    expect(pa.equals(pb)).toBe(true)
    expect(JSON.parse(pa.toString()).gitCommit).toBeNull()
    ctx.db.sqlite.prepare('UPDATE runs SET git_commit = ? WHERE id = ?').run('c0ffee', b.runId)
    expect(JSON.parse(readFileSync(planRun(ctx, b.runId).planPath, 'utf8')).gitCommit).toBe(
      'c0ffee',
    )
    ctx.close()
  })
})

describe('délai d’une mutation (D-029)', () => {
  it('timeout_ms pour la cible + coût de démarrage mesuré en baseline', async () => {
    const adapter = new FakeAdapter((o) =>
      o.mode === 'observe'
        ? observeRun(TESTS, { process: { ...observeRun([]).process, durationMs: 1234.2 } })
        : fuzzRun(o),
    )
    const ctx = context(
      adapter,
      'version: 1\nmutations: { seed: 7, per_input: 1 }\nexecution: { timeout_ms: 2000 }\n',
    )
    const b = await runBaseline(ctx)
    planRun(ctx, b.runId)
    await runFuzz(ctx, b.runId)
    const fuzz = adapter.runs.filter((r) => r.mode === 'fuzz')
    expect(fuzz.length).toBeGreaterThan(0)
    expect(fuzz.every((r) => r.timeoutMs === 3235)).toBe(true)
    expect(mutationTimeoutMs(ctx, 0)).toBe(2000)
    ctx.close()
  })
})
