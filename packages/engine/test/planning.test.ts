import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  mutationTimeoutMs,
  planRun,
  readPlan,
  runBaseline,
  runFuzz,
  type PlanFilters,
} from '../src/index.js'
import { context, FakeAdapter, fuzzRun, observeRun, scripted } from './fake.js'

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

describe('ciblage (B-02 : --test, --file, --function, --strategy)', () => {
  const MANY = [
    {
      name: 'crée Ada',
      file: 'tests/users.test.js',
      calls: [{ module: 'src/users.js', export: 'createUser', args: [{ n: 'a' }] }],
    },
    {
      name: 'lit',
      file: 'tests/read.test.js',
      calls: [{ module: 'src/read.js', export: 'read', args: [1] }],
    },
  ]
  async function plan(filters: PlanFilters | undefined) {
    const ctx = context(
      scripted(MANY),
      "version: 1\nmutations: { seed: 1, per_input: 3, strategies: [type, 'null'] }\n",
    )
    const b = await runBaseline(ctx)
    const s = planRun(ctx, b.runId, filters === undefined ? {} : { filters })
    const p = JSON.parse(readFileSync(s.planPath, 'utf8')) as {
      mutations: { export: string; strategy: string }[]
    }
    const run = ctx.reader.getRun(b.runId)
    ctx.close()
    return { mutations: p.mutations, run }
  }
  it('sans ciblage : tout, run non partiel', async () => {
    const r = await plan(undefined)
    expect(new Set(r.mutations.map((m) => m.export))).toEqual(new Set(['createUser', 'read']))
    expect([r.run?.partial, r.run?.info['filters']]).toEqual([false, undefined])
  })
  it.each([
    [{ tests: ['Ada'] }, ['createUser']],
    [{ files: ['tests/read.test.js'] }, ['read']],
    [{ files: ['src/users.*'] }, ['createUser']],
    [{ functions: ['read'] }, ['read']],
    [{ functions: ['src/users.js#createUser'] }, ['createUser']],
  ])('%j ⇒ %j, run partiel, ciblage enregistré', async (filters, exports) => {
    const r = await plan(filters)
    expect([...new Set(r.mutations.map((m) => m.export))]).toEqual(exports)
    expect([r.run?.partial, r.run?.info['filters']]).toEqual([true, filters])
  })
  it('--strategy restreint les stratégies ; inconnue ⇒ CONFIG_FAILURE', async () => {
    const r = await plan({ strategies: ['null'] })
    expect(new Set(r.mutations.map((m) => m.strategy))).toEqual(new Set(['null']))
    expect(r.run?.partial).toBe(true)
    await expect(plan({ strategies: ['semantic'] })).rejects.toMatchObject({
      kind: 'CONFIG_FAILURE',
      details: ['semantic'],
    })
    const all = await plan({ strategies: ['type', 'null'], tests: [] })
    expect(all.run?.partial).toBe(false)
  })
})

describe('plan : refus explicites et robustesse', () => {
  it('run inconnu ou sans baseline valide ⇒ PROJECT_FAILURE qui nomme l’état', async () => {
    const ctx = context(scripted([{ name: 'rouge', status: 'failed', calls: [] }]))
    const b = await runBaseline(ctx, { allowFailing: true })
    expect(() => planRun(ctx, 'absent')).toThrow(/run absent sans baseline valide \(inconnu\)/)
    expect(() => planRun(ctx, b.runId)).toThrow(/\(BASELINE_FAILED\)/)
    ctx.close()
  })
  it('estimation sans durée de baseline enregistrée : 0, sans avertissement', async () => {
    const ctx = context(scripted(TESTS), 'version: 1\nexecution: { warn_after_ms: 0 }\n')
    const b = await runBaseline(ctx)
    expect(planRun(ctx, b.runId).warn).toBe(true)
    ctx.writer.updateRun(b.runId, { info: {} })
    const s = planRun(ctx, b.runId)
    expect([s.estimateMs, s.warn]).toEqual([0, false])
    expect(s.planned).toBeGreaterThan(0)
    ctx.close()
  })
  it('readPlan : fichier absent ⇒ INFRA_FAILURE ; schéma inconnu ⇒ CONFIG_FAILURE', () => {
    const ctx = context(scripted(TESTS))
    const path = join(ctx.dataDir, 'plan.json')
    expect(() => readPlan(path)).toThrow(expect.objectContaining({ kind: 'INFRA_FAILURE' }))
    for (const bad of [{ schemaVersion: 2, mutations: [] }, { schemaVersion: 1 }]) {
      writeFileSync(path, JSON.stringify(bad))
      expect(() => readPlan(path)).toThrow(expect.objectContaining({ kind: 'CONFIG_FAILURE' }))
    }
    ctx.close()
  })
})
