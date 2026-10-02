import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { planRun, runBaseline } from '../src/index.js'
import { context, FakeAdapter, observeRun } from './fake.js'

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
