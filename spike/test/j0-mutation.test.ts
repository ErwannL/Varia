import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { diffSnapshots, gitSnapshot, manifestSnapshot, type Snapshot } from '../src/integrity.js'
import { compareBaselines, type Observation } from '../src/observe.js'
import type { Plan, PlannedMutation } from '../src/plan.js'
import { groupAlive } from '../src/proc.js'
import type { MutationResult, Spike } from '../src/spike.js'
import { EXAMPLE, newDataDir, newSpike, pick, PLAN_OPTIONS } from './helpers.js'

let spike: Spike
let baseline: Observation
let plan: Plan
let before: { git: Snapshot; manifest: Snapshot }
const VALID = 'createUser crée un utilisateur valide'

beforeAll(async () => {
  before = { git: gitSnapshot(EXAMPLE), manifest: manifestSnapshot(EXAMPLE) }
  spike = newSpike(newDataDir())
  baseline = (await spike.baseline()).observation
  plan = spike.plan(baseline, PLAN_OPTIONS)
  spike.savePlan(plan)
})

afterAll(() => spike.dispose())

const run = (m: PlannedMutation): Promise<MutationResult> => spike.execute(plan, m)

describe('createUser (J0-3/4/5/6)', () => {
  it('J0-3 name = null ⇒ HANDLED (ValidationError)', async () => {
    const r = await run(
      pick(plan, { export: 'createUser', test: VALID, pathStr: 'arg0.name', value: null }),
    )
    expect(r.classification.status).toBe('HANDLED')
    expect(r.classification.error?.constructorChain).toContain('ValidationError')
  })
  it('J0-4 name = {} ⇒ CRASH (TypeError)', async () => {
    const r = await run(
      pick(plan, { export: 'createUser', test: VALID, pathStr: 'arg0.name', value: {} }),
    )
    expect(r.classification.status).toBe('CRASH')
    expect(r.classification.error?.name).toBe('TypeError')
    expect(r.classification.error?.message).toMatch(/trim is not a function/)
  })
  it('J0-5 name = "" ⇒ HANDLED (chaîne vide après trim, documenté dans l’exemple)', async () => {
    const r = await run(
      pick(plan, { export: 'createUser', test: VALID, pathStr: 'arg0.name', value: '' }),
    )
    expect(r.classification.status).toBe('HANDLED')
  })
  it('J0-6 le test muté échoue, la classification reste celle de la cible', async () => {
    const handled = await run(
      pick(plan, { export: 'createUser', test: VALID, pathStr: 'arg0.name', value: null }),
    )
    const crash = await run(
      pick(plan, { export: 'createUser', test: VALID, pathStr: 'arg0.name', value: [] }),
    )
    expect(handled.classification.testStatus).toBe('failed')
    expect(crash.classification.testStatus).toBe('failed')
    expect([handled.classification.status, crash.classification.status]).toEqual([
      'HANDLED',
      'CRASH',
    ])
  })
})

describe('isolement des processus (J0-8/9)', () => {
  it('J0-8 repeat(count = null) ⇒ TIMEOUT, arbre tué, la mutation suivante s’exécute', async () => {
    const t0 = performance.now()
    const r = await run(pick(plan, { export: 'repeat', pathStr: 'arg1', value: null }))
    expect(r.classification.status).toBe('TIMEOUT')
    expect(performance.now() - t0).toBeLessThan(10_000)
    if (process.platform !== 'win32') expect(groupAlive(r.run.process.pid ?? -1)).toBe(false)
    const next = await run(
      pick(plan, { export: 'createUser', test: VALID, pathStr: 'arg0.name', value: null }),
    )
    expect(next.classification.status).toBe('HANDLED')
  })
  it('au plus 3 mutations planifiées sur repeat', () => {
    expect(plan.mutations.filter((m) => m.export === 'repeat')).toHaveLength(3)
  })
  it('J0-9 exitOn("boom") ⇒ CRASH (sortie anormale), la suivante s’exécute', async () => {
    const r = await run(pick(plan, { export: 'exitOn', pathStr: 'arg0', value: 'boom' }))
    expect(r.classification.status).toBe('CRASH')
    expect(r.classification.subtype).toBe('PROCESS_EXIT')
    expect(r.run.process.exitCode).toBe(1)
    const next = await run(pick(plan, { export: 'exitOn', pathStr: 'arg0', value: null }))
    expect(next.classification.status).toBe('PASSED')
  })
})

describe('call sites (J0-12/13)', () => {
  it('J0-12 seul le 2ᵉ appel est muté', async () => {
    const m = pick(plan, {
      export: 'createUser',
      test: 'createUser crée trois utilisateurs',
      pathStr: 'arg0.age',
      sequence: 1,
      value: '45',
    })
    const r = await run(m)
    const calls = r.observation.calls.filter((c) => c.export === 'createUser')
    expect(calls.map((c) => c.mutated)).toEqual([false, true, false])
    const base = baseline.calls.filter((c) => c.testId === m.testId)
    expect(calls.map((c) => c.argsFingerprint)).toEqual(base.map((c) => c.argsFingerprint))
    expect(calls.map((c) => c.outcome.kind)).toEqual(['return', 'return', 'return'])
    expect((calls[1]?.outcome.value as Record<string, unknown>)['age']).toBe('45')
    expect((calls[2]?.outcome.value as Record<string, unknown>)['age']).toBe(21)
  })
  it('J0-13 empreinte différente ⇒ SKIPPED / AMBIGUOUS_CALL_SITE, jamais appliquée', async () => {
    const second = (await spike.baseline()).observation
    const flaky = compareBaselines(baseline, second).flaky.map((f) => f.name)
    expect(flaky).toEqual(['echoValue renvoie un horodatage'])
    const m = pick(plan, {
      export: 'echoValue',
      test: 'echoValue renvoie un horodatage',
      pathStr: 'arg0',
      value: null,
    })
    const r = await run(m)
    expect(r.classification.status).toBe('SKIPPED')
    expect(r.classification.reason).toBe('AMBIGUOUS_CALL_SITE')
    expect(r.observation.calls.some((c) => c.mutated)).toBe(false)
    expect(r.classification.testStatus).toBe('passed')
  })
})

describe('async (J0-14)', () => {
  it('rejet, levée synchrone et retour résolu sont distingués', async () => {
    const reject = await run(pick(plan, { export: 'fetchUser', pathStr: 'arg0', value: '7' }))
    const thrown = await run(pick(plan, { export: 'fetchUser', pathStr: 'arg0', value: {} }))
    const resolved = await run(pick(plan, { export: 'fetchUser', pathStr: 'arg0', value: 1 }))
    expect([reject.classification.outcome, reject.classification.status]).toEqual([
      'reject',
      'HANDLED',
    ])
    expect([thrown.classification.outcome, thrown.classification.status]).toEqual([
      'throw',
      'CRASH',
    ])
    expect([resolved.classification.outcome, resolved.classification.status]).toEqual([
      'return',
      'PASSED',
    ])
    const call = resolved.observation.calls.find((c) => c.mutated)
    expect(call?.outcome.async).toBe(true)
  })
})

describe('J0-18 ECHO', () => {
  const ECHO_TEST = 'echoValue renvoie sa valeur'
  it('type {} renvoyé tel quel ⇒ SUSPICIOUS_ACCEPT / ECHO', async () => {
    const r = await run(
      pick(plan, {
        export: 'echoValue',
        test: ECHO_TEST,
        pathStr: 'arg0',
        strategy: 'type',
        value: {},
      }),
    )
    expect(r.classification).toMatchObject({
      status: 'PASSED',
      subtype: 'SUSPICIOUS_ACCEPT',
      reason: 'ECHO',
      echoPath: 'return.received',
    })
  })
  it('type 123 renvoyé tel quel ⇒ ECHO', async () => {
    const r = await run(
      pick(plan, {
        export: 'echoValue',
        test: ECHO_TEST,
        pathStr: 'arg0',
        strategy: 'type',
        value: 123,
      }),
    )
    expect(r.classification.reason).toBe('ECHO')
  })
  it('null renvoyé tel quel ⇒ pas d’ECHO', async () => {
    const r = await run(
      pick(plan, { export: 'echoValue', test: ECHO_TEST, pathStr: 'arg0', value: null }),
    )
    expect(r.classification.status).toBe('PASSED')
    expect(r.classification.subtype).toBeUndefined()
  })
})

describe('J0-10 intégrité du projet', () => {
  it('arbre git et manifeste identiques après toutes les exécutions', () => {
    expect(diffSnapshots(before.git, gitSnapshot(EXAMPLE))).toEqual([])
    expect(diffSnapshots(before.manifest, manifestSnapshot(EXAMPLE))).toEqual([])
  })
})
