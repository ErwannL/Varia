// R-02 : scénarios d'acceptation du §5 (J4) sur examples/pytest-project, par le MOTEUR et l'adaptateur
// pytest réels (le CLI n'est pas encore branché sur `pytest`). (1) baseline et observation, (2)
// stabilité, (3) HANDLED / CRASH / ECHO, (4) statut du test sans influence, (5) plan identique octet
// pour octet, (8) rejet / levée / retour et exception de tâche jamais récupérée, (9) une seule
// occurrence mutée, (10) empreinte divergente, (12) projet inchangé.
// Les scénarios (6) (7) (11) (13) (14) sont dans pytest-process.test.ts.
import { PytestAdapter } from '@varia/adapter-pytest'
import type { PlannedMutation } from '@varia/core'
import { diffSnapshots, gitSnapshot, manifestSnapshot, mutationId } from '@varia/core'
import {
  EngineContext,
  planRun,
  readPlan,
  replayMutation,
  runBaseline,
  runFuzz,
  savePlan,
} from '@varia/engine'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

export const PYTEST = resolve('examples/pytest-project')

const before = { git: gitSnapshot(PYTEST), manifest: manifestSnapshot(PYTEST) }
const VALID = 'TestCreateUser test_valid'
let ctx: EngineContext
let runId: string
let plan: { mutations: PlannedMutation[] }
let planPath: string

const pick = (w: {
  export: string
  pathStr: string
  test?: string
  strategy?: string
  sequence?: number
  value?: unknown
}) => {
  const m = plan.mutations.find(
    (x) =>
      x.export === w.export &&
      x.pathStr === w.pathStr &&
      (w.test === undefined || x.testName === w.test) &&
      (w.strategy === undefined || x.strategy === w.strategy) &&
      (w.sequence === undefined || x.sequence === w.sequence) &&
      (!('value' in w) || (x.op === 'set' && JSON.stringify(x.value) === JSON.stringify(w.value))),
  )
  if (!m) throw new Error(`mutation introuvable : ${JSON.stringify(w)}`)
  return m
}

beforeAll(async () => {
  ctx = new EngineContext({
    root: PYTEST,
    adapter: new PytestAdapter(),
    dataDir: mkdtempSync(join(tmpdir(), 'varia-pytest-')),
  })
  const b = await runBaseline(ctx)
  runId = b.runId
  planPath = planRun(ctx, runId).planPath
  plan = JSON.parse(readFileSync(planPath, 'utf8')) as typeof plan
})

describe('pytest (1) (2) : baseline, observation, stabilité', () => {
  it('(1) 13 tests verts, appels create_user observés avec leurs arguments (mot de passe masqué)', () => {
    const tests = ctx.reader.tests(runId)
    expect(tests).toHaveLength(13)
    expect(tests.every((t) => t.status === 'passed')).toBe(true)
    const args = ctx.reader
      .callSites(runId)
      .filter((c) => c.export === 'create_user')
      .map((c) => (c.args as Record<string, unknown>[])[0])
    expect(args.map((a) => a?.['name']).sort()).toEqual([
      'Ada',
      'Alice',
      'Bob',
      'Chloé',
      'Erwann',
      'Grace',
      'Linus',
    ])
    expect(args.every((a) => (a?.['password'] as { $redacted?: boolean }).$redacted)).toBe(true)
    // Test paramétré : trois tests pytest distincts, paramètres substitués dans le nom.
    expect(
      tests
        .filter((t) => t.name.startsWith('TestCreateUser test_accepts'))
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      'TestCreateUser test_accepts[Alice-30]',
      'TestCreateUser test_accepts[Bob-40]',
      // pytest échappe les identifiants non ASCII de paramètres (« é » ⇒ « \\xe9 ») : nom tel quel.
      'TestCreateUser test_accepts[Chlo\\xe9-50]',
    ])
  })
  it('(2) exécutions répétées identiques : seul le test aux arguments non déterministes est FLAKY', () => {
    const flaky = ctx.reader.tests(runId).filter((t) => t.flaky)
    expect(flaky.map((t) => [t.name, t.flakyReasons])).toEqual([
      ['test_echo_stamp', ['NON_DETERMINISTIC_INPUT']],
    ])
  })
  it('profondeurs 0 et 1 (contextvars, tâches asyncio parallèles), appel interne non observé (listé)', () => {
    const cs = ctx.reader.callSites(runId)
    expect(cs.filter((c) => c.export === 'inner').map((c) => c.depth)).toEqual([1, 1])
    expect(cs.filter((c) => c.export === 'outer').map((c) => c.depth)).toEqual([0, 0])
    expect(cs.some((c) => c.export === 'helper')).toBe(false)
    const targets = ctx.reader.targets(runId)
    expect(targets.find((t) => t.export === 'helper')?.status).toBe('NEVER_CALLED')
    expect(targets.find((t) => t.export === 'inner')?.status).toBe('TRANSITIVE_ONLY')
    expect(targets.find((t) => t.export === 'ValidationError')?.status).toBe('UNSUPPORTED')
    expect(plan.mutations.some((m) => m.export === 'inner')).toBe(false)
  })
})

describe('pytest (5) : plan', () => {
  it('même graine ⇒ plan identique octet pour octet, y compris après une nouvelle baseline', async () => {
    const a = readFileSync(planPath)
    const again = readFileSync(planRun(ctx, runId).planPath)
    const b2 = await runBaseline(ctx)
    const third = readFileSync(planRun(ctx, b2.runId).planPath)
    expect(a.equals(again)).toBe(true)
    expect(a.equals(third)).toBe(true)
    expect(plan.mutations.filter((m) => m.export === 'repeat')).toHaveLength(3)
  })
})

describe('pytest (3) (4) (8) (9) : classification par rejeu', () => {
  const replay = (m: PlannedMutation) => replayMutation(ctx, m.id)
  it('(3) (4) None ⇒ HANDLED, {} ⇒ CRASH (TypeError), "" ⇒ HANDLED ; test en échec dans les trois cas', async () => {
    const out = []
    for (const value of [null, {}, ''])
      out.push(
        (await replay(pick({ export: 'create_user', test: VALID, pathStr: 'arg0.name', value })))
          .classification,
      )
    expect(out.map((c) => c.status)).toEqual(['HANDLED', 'CRASH', 'HANDLED'])
    expect(out.map((c) => c.testStatus)).toEqual(['failed', 'failed', 'failed'])
    expect(out[1]?.error?.constructorChain).toContain('TypeError')
  })
  it('(3) écho d’une valeur d’un autre type ⇒ SUSPICIOUS_ACCEPT / ECHO ; None renvoyé ⇒ pas d’ECHO', async () => {
    const T = 'test_echo_value'
    const echo = await replay(
      pick({ export: 'echo_value', test: T, pathStr: 'arg0', strategy: 'type', value: {} }),
    )
    const nul = await replay(pick({ export: 'echo_value', test: T, pathStr: 'arg0', value: null }))
    expect([
      echo.classification.subtype,
      echo.classification.reason,
      echo.classification.echoPath,
    ]).toEqual(['SUSPICIOUS_ACCEPT', 'ECHO', 'return.received'])
    expect([nul.classification.status, nul.classification.subtype]).toEqual(['PASSED', undefined])
  })
  it('(8) rejet de coroutine, levée synchrone et retour résolu distingués', async () => {
    const out = []
    for (const value of ['7', {}])
      out.push(
        (await replay(pick({ export: 'fetch_user', pathStr: 'arg0', value }))).classification,
      )
    const positive = plan.mutations.find(
      (m) => m.export === 'fetch_user' && Number.isInteger(m.value) && (m.value as number) > 0,
    )
    if (!positive) throw new Error('aucun entier positif planifié pour fetch_user')
    out.push((await replay(positive)).classification)
    expect(out.map((c) => [c.outcome, c.status])).toEqual([
      ['reject', 'HANDLED'],
      ['throw', 'CRASH'],
      ['return', 'PASSED'],
    ])
  })
  it('(8) exception de tâche asyncio jamais récupérée, après un retour normal ⇒ CRASH / UNHANDLED_REJECTION', async () => {
    const c = (
      await replay(pick({ export: 'schedule_welcome', pathStr: 'arg0.email', value: null }))
    ).classification
    expect([c.status, c.subtype, c.error?.name]).toEqual([
      'CRASH',
      'UNHANDLED_REJECTION',
      'TypeError',
    ])
  })
  it('(9) seule la 2ᵉ des trois occurrences est mutée, les autres gardent leur empreinte', async () => {
    const m = pick({
      export: 'create_user',
      test: 'TestCreateUser test_three_users',
      pathStr: 'arg0.age',
      sequence: 1,
      value: '45',
    })
    const calls = (await replay(m)).calls.filter((c) => c.export === 'create_user')
    expect(calls.map((c) => c.mutated)).toEqual([false, true, false])
    const base = ctx.reader
      .callSites(runId)
      .filter((c) => c.testId === m.testId)
      .sort((a, b) => a.sequence - b.sequence)
    expect(calls.map((c) => c.argsFingerprint)).toEqual(base.map((c) => c.argsFingerprint))
  })
})

describe('pytest (10) : empreinte divergente', () => {
  it('mutation forcée sur le call site non déterministe ⇒ SKIPPED / AMBIGUOUS_CALL_SITE', async () => {
    const test = ctx.reader.tests(runId).find((t) => t.name === 'test_echo_stamp')
    const site = ctx.reader
      .callSites(runId)
      .find((c) => c.testId === test?.testId && c.export === 'echo_value')
    if (!test || !site) throw new Error('call site introuvable')
    const forced: PlannedMutation = {
      id: mutationId(site.callSiteId, 'arg0', 'null', 'set', null),
      callSiteId: site.callSiteId,
      testId: test.testId,
      testFile: test.file,
      testName: test.name,
      module: site.module,
      export: site.export,
      depth: 0,
      sequence: site.sequence,
      argsFingerprint: site.argsFingerprint,
      path: ['0'],
      pathStr: 'arg0',
      strategy: 'null',
      op: 'set',
      original: (site.args as string[])[0] ?? '',
      value: null,
      originalType: 'string',
      mutatedType: 'null',
    }
    const fresh = await runBaseline(ctx)
    savePlan(ctx, fresh.runId, { ...readPlan(planPath), possible: 1, mutations: [forced] })
    await runFuzz(ctx, fresh.runId)
    expect(ctx.reader.results(fresh.runId).map((r) => [r.mutationId, r.status, r.reason])).toEqual([
      [forced.id, 'SKIPPED', 'AMBIGUOUS_CALL_SITE'],
    ])
  })
})

afterAll(() => {
  ctx.close()
  // (12) Projet inchangé (git et manifeste) après toutes les exécutions de ce fichier.
  expect(diffSnapshots(before.git, gitSnapshot(PYTEST))).toEqual([])
  expect(diffSnapshots(before.manifest, manifestSnapshot(PYTEST))).toEqual([])
})
