// R-04 : scénarios d'acceptation du §5 (J4) sur examples/junit-project avec l'adaptateur JUnit RÉEL
// (agent Java + console JUnit) et le MOTEUR (runBaseline / planRun / replayMutation / runFuzz).
// (1) baseline et observation, (2) stabilité, (3) HANDLED / CRASH / ECHO, (4) statut du test sans
// influence, (5) plan identique octet pour octet, (8) rejet / levée / retour et exception non attrapée,
// (9) une seule occurrence mutée, (10) empreinte divergente, (12) projet inchangé.
// Les scénarios (6) (7) (11) (13) (14) sont dans junit-process.test.ts.
import { JUnitAdapter } from '@varia/adapter-junit'
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

export const JUNIT = resolve('examples/junit-project')
const before = { git: gitSnapshot(JUNIT), manifest: manifestSnapshot(JUNIT) }
const ctx = new EngineContext({
  root: JUNIT,
  adapter: new JUnitAdapter(),
  dataDir: mkdtempSync(join(tmpdir(), 'varia-junit-e2e-')),
})
const U = 'com.example.UsersTest#'
const VALID = `${U}createsValidUser()`
let runId = ''
let plan: { mutations: PlannedMutation[] } = { mutations: [] }

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
const replay = (m: PlannedMutation) => replayMutation(ctx, m.id)

beforeAll(async () => {
  const b = await runBaseline(ctx)
  expect(b.state, JSON.stringify(b)).toBe('BASELINE_DONE')
  runId = b.runId
  const p = planRun(ctx, runId, {})
  plan = readPlan(p.planPath)
}, 600_000)

afterAll(() => {
  ctx.close()
  // (12) Projet inchangé (git et manifeste) après toutes les exécutions de ce fichier.
  expect(diffSnapshots(before.git, gitSnapshot(JUNIT))).toEqual([])
  expect(diffSnapshots(before.manifest, manifestSnapshot(JUNIT))).toEqual([])
})

describe('JUnit (1) (2) : baseline, observation, stabilité', () => {
  it('(1) 13 tests verts, appels createUser observés avec leurs arguments (mot de passe masqué)', () => {
    const tests = ctx.reader.tests(runId)
    expect(tests).toHaveLength(13)
    expect(tests.every((t) => t.status === 'passed')).toBe(true)
    const args = ctx.reader
      .callSites(runId)
      .filter((c) => c.export === 'createUser')
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
    // Test paramétré : trois invocations, trois tests distincts.
    expect(tests.filter((t) => t.name.startsWith(`${U}accepts(`)).map((t) => t.name)).toEqual([
      `${U}accepts(java.lang.String, int) [1]`,
      `${U}accepts(java.lang.String, int) [2]`,
      `${U}accepts(java.lang.String, int) [3]`,
    ])
  })
  it('(2) exécutions répétées identiques : seul le test aux arguments non déterministes est FLAKY', () => {
    const flaky = ctx.reader.tests(runId).filter((t) => t.flaky)
    expect(flaky.map((t) => [t.name, t.flakyReasons])).toEqual([
      ['com.example.ValuesTest#echoesTimestamp()', ['NON_DETERMINISTIC_INPUT']],
    ])
  })
  it('profondeurs 0 et 1, transitif non muté, appel interne (méthode privée) non observé et listé', () => {
    const cs = ctx.reader.callSites(runId)
    expect(cs.filter((c) => c.export === 'inner').map((c) => c.depth)).toEqual([1, 1])
    expect(cs.filter((c) => c.export === 'outer').map((c) => c.depth)).toEqual([0, 0])
    expect(cs.some((c) => c.export === 'helper')).toBe(false)
    const targets = ctx.reader.targets(runId)
    expect(targets.find((t) => t.export === 'helper')?.status).toBe('UNSUPPORTED')
    expect(targets.find((t) => t.export === 'inner')?.status).toBe('TRANSITIVE_ONLY')
    expect(plan.mutations.some((m) => m.export === 'inner')).toBe(false)
  })
})

describe('JUnit (5) : plan', () => {
  it('même graine ⇒ plan identique octet pour octet, y compris après une nouvelle baseline', async () => {
    const a = readFileSync(planRun(ctx, runId, {}).planPath)
    const b2 = await runBaseline(ctx)
    const c = readFileSync(planRun(ctx, b2.runId, {}).planPath)
    expect(a.equals(c)).toBe(true)
    expect(plan.mutations.filter((m) => m.export === 'repeat')).toHaveLength(3)
  }, 600_000)
})

describe('JUnit (3) (4) (8) (9) : classification par rejeu', () => {
  it('(3) (4) null ⇒ HANDLED, {} ⇒ CRASH (ClassCastException), "" ⇒ HANDLED ; test en échec dans les trois cas', async () => {
    const out = []
    for (const value of [null, {}, ''])
      out.push(
        (await replay(pick({ export: 'createUser', test: VALID, pathStr: 'arg0.name', value })))
          .classification,
      )
    expect(out.map((c) => c.status)).toEqual(['HANDLED', 'CRASH', 'HANDLED'])
    expect(out.map((c) => c.testStatus)).toEqual(['failed', 'failed', 'failed'])
    expect(out[1]?.error?.constructorChain).toEqual([
      'ClassCastException',
      'RuntimeException',
      'Exception',
      'Throwable',
    ])
  }, 600_000)
  it('(3) écho d’une valeur d’un autre type ⇒ SUSPICIOUS_ACCEPT / ECHO ; null renvoyé ⇒ pas d’ECHO', async () => {
    const T = 'com.example.ValuesTest#echoesValue()'
    const echo = await replay(
      pick({ export: 'echoValue', test: T, pathStr: 'arg0', strategy: 'type', value: {} }),
    )
    const nul = await replay(pick({ export: 'echoValue', test: T, pathStr: 'arg0', value: null }))
    expect([
      echo.classification.subtype,
      echo.classification.reason,
      echo.classification.echoPath,
    ]).toEqual(['SUSPICIOUS_ACCEPT', 'ECHO', 'return.received'])
    expect([nul.classification.status, nul.classification.subtype]).toEqual(['PASSED', undefined])
  }, 600_000)
  it('(8) future en échec, levée synchrone et future réussie distinguées', async () => {
    const out = []
    for (const value of ['7', {}])
      out.push((await replay(pick({ export: 'fetchUser', pathStr: 'arg0', value }))).classification)
    const positive = plan.mutations.find(
      (m) =>
        m.export === 'fetchUser' &&
        Number.isInteger(m.value) &&
        (m.value as number) > 0 &&
        // Au-delà de 2^31−1, la sonde reconstruit un Long (pas un Integer) : future en échec.
        (m.value as number) <= 2147483647,
    )
    if (!positive) throw new Error('aucun entier positif planifié pour fetchUser')
    out.push((await replay(positive)).classification)
    expect(out.map((c) => [c.outcome, c.status])).toEqual([
      ['reject', 'HANDLED'],
      ['throw', 'CRASH'],
      ['return', 'PASSED'],
    ])
  }, 600_000)
  it('(8) exception non attrapée dans un fil, après un retour normal ⇒ CRASH / UNHANDLED_REJECTION', async () => {
    const c = (
      await replay(pick({ export: 'scheduleWelcome', pathStr: 'arg0.email', value: null }))
    ).classification
    expect([c.status, c.subtype, c.error?.name]).toEqual([
      'CRASH',
      'UNHANDLED_REJECTION',
      'NullPointerException',
    ])
  }, 600_000)
  it('(9) seule la 2ᵉ des trois occurrences est mutée, les autres gardent leur empreinte', async () => {
    const m = pick({
      export: 'createUser',
      test: `${U}createsThreeUsers()`,
      pathStr: 'arg0.age',
      sequence: 1,
      value: '45',
    })
    const calls = (await replay(m)).calls.filter((c) => c.export === 'createUser')
    expect(calls.map((c) => c.mutated)).toEqual([false, true, false])
    const base = ctx.reader
      .callSites(runId)
      .filter((c) => c.testId === m.testId)
      .sort((a, b) => a.sequence - b.sequence)
    expect(calls.map((c) => c.argsFingerprint)).toEqual(base.map((c) => c.argsFingerprint))
  }, 600_000)
  it('mutation d’un type impossible en Java (paramètre primitif) : jamais forcée, SKIPPED / TYPE_MISMATCH', async () => {
    const c = (await replay(pick({ export: 'repeat', pathStr: 'arg1', value: null })))
      .classification
    expect([c.status, c.reason]).toEqual(['SKIPPED', 'TYPE_MISMATCH'])
  }, 600_000)
})

describe('JUnit (10) : empreinte divergente', () => {
  it('plan forcé sur le call site non déterministe ⇒ SKIPPED / AMBIGUOUS_CALL_SITE', async () => {
    const b = await runBaseline(ctx)
    const test = ctx.reader
      .tests(b.runId)
      .find((t) => t.name === 'com.example.ValuesTest#echoesTimestamp()')
    const site = ctx.reader
      .callSites(b.runId)
      .find((c) => c.testId === test?.testId && c.export === 'echoValue')
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
    savePlan(ctx, b.runId, {
      schemaVersion: 1,
      variaVersion: '0.1.0',
      seed: 1,
      gitCommit: null,
      configHash: '',
      possible: 1,
      mutations: [forced],
    })
    await runFuzz(ctx, b.runId)
    expect(ctx.reader.results(b.runId).map((r) => [r.mutationId, r.status, r.reason])).toEqual([
      [forced.id, 'SKIPPED', 'AMBIGUOUS_CALL_SITE'],
    ])
  }, 600_000)
})
