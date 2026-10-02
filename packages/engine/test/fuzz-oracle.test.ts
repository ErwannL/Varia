// Fuzz → oracle : signaux transmis au classement (durée de baseline, hints) et persistés (drapeaux).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Plan } from '@varia/core'
import type { RunRecord } from '@varia/database'
import { planRun, runBaseline, runFuzz, savePlan, startupMs } from '../src/index.js'
import { context, scripted, type FakeTest } from './fake.js'

const TESTS: FakeTest[] = [{ name: 'a', calls: [{ export: 'f', args: [5] }] }]
const NULL_ONLY = "version: 1\nmutations: { seed: 1, per_input: 1, strategies: ['null'] }\n"
// Test muté 1000 ms contre 5 ms en baseline : au-delà de 10 × et du plancher de 100 ms.
const slow = scripted(TESTS, () => ({ returns: null, testDurationMs: 1000 }))

describe('fuzz : signaux de l’oracle', () => {
  it('test muté beaucoup plus lent qu’en baseline ⇒ drapeau SLOW persisté', async () => {
    const ctx = context(slow, NULL_ONLY)
    const b = await runBaseline(ctx)
    planRun(ctx, b.runId)
    await runFuzz(ctx, b.runId)
    const results = ctx.reader.results(b.runId)
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.flags?.includes('SLOW'))).toBe(true)
    ctx.close()
  })
  it('plan importé dont le test est absent de la baseline : jamais SLOW (pas de référence)', async () => {
    const ctx = context(slow, NULL_ONLY)
    const b = await runBaseline(ctx)
    const plan = JSON.parse(readFileSync(planRun(ctx, b.runId).planPath, 'utf8')) as Plan
    savePlan(ctx, b.runId, {
      ...plan,
      mutations: plan.mutations.map((m) => ({ ...m, testId: 'inconnu' })),
    })
    await runFuzz(ctx, b.runId)
    const results = ctx.reader.results(b.runId)
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.flags?.length === 0)).toBe(true)
    ctx.close()
  })
  it('hint de plage violé et accepté par la cible ⇒ SUSPICIOUS_ACCEPT / HINT_VIOLATION', async () => {
    const ctx = context(
      scripted(TESTS),
      "version: 1\nmutations: { seed: 1, per_input: 5, strategies: [boundary] }\ninputs: { hints: [{ path: 'f#arg0', range: [0, 10] }] }\n",
    )
    const b = await runBaseline(ctx)
    planRun(ctx, b.runId)
    await runFuzz(ctx, b.runId)
    const suspicious = ctx.reader.results(b.runId).filter((r) => r.subtype === 'SUSPICIOUS_ACCEPT')
    expect(suspicious.length).toBeGreaterThan(0)
    expect(suspicious.every((r) => r.reason === 'HINT_VIOLATION')).toBe(true)
    ctx.close()
  })
  it('coût de démarrage : durée de baseline enregistrée, 0 si absente', () => {
    expect(startupMs({ info: { baselineDurationMs: 42 } } as unknown as RunRecord)).toBe(42)
    expect(startupMs({ info: {} } as unknown as RunRecord)).toBe(0)
  })
})
