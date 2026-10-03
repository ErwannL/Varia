// X-01 : scénarios d'acceptation du §5 (J4) sur examples/custom-project, lanceur FACTICE (runner.cjs,
// aucun import de Varia) branché par l'adaptateur custom, via le MOTEUR réel (le CLI sera branché à
// part). (1) baseline et observation, (2) stabilité, (3) HANDLED / CRASH / ECHO, (4) statut du test
// sans influence, (5) plan identique octet pour octet, (8) rejet / levée / retour et rejet non géré,
// (9) une seule occurrence mutée, (10) empreinte divergente, (12) projet inchangé.
// (6) (7) (11) (13) (14) : custom-process.test.ts.
import { CustomAdapter } from '@varia/adapter-custom'
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

export const CUSTOM = resolve('examples/custom-project')
const before = { git: gitSnapshot(CUSTOM), manifest: manifestSnapshot(CUSTOM) }
const ctx = new EngineContext({
  root: CUSTOM,
  adapter: CustomAdapter.fromConfig(CUSTOM),
  dataDir: mkdtempSync(join(tmpdir(), 'varia-j4-custom-')),
})
const VALID = 'createUser crée un utilisateur valide'
let runId = ''
let plan: { mutations: PlannedMutation[] }
let planBytes: Buffer

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
  const b = await runBaseline(ctx)
  expect(b.state).toBe('BASELINE_DONE')
  runId = b.runId
  const s = planRun(ctx, runId)
  planBytes = readFileSync(s.planPath)
  plan = JSON.parse(planBytes.toString('utf8')) as typeof plan
})

describe('custom (1) (2) : baseline, observation, stabilité', () => {
  it('(1) 13 tests verts, appels createUser observés avec leurs arguments', () => {
    const tests = ctx.reader.tests(runId)
    expect(tests).toHaveLength(13)
    expect(tests.every((t) => t.status === 'passed')).toBe(true)
    const names = ctx.reader
      .callSites(runId)
      .filter((c) => c.export === 'createUser')
      .map((c) => (c.args as Record<string, unknown>[])[0]?.['name'])
    expect(names.sort()).toEqual(['Ada', 'Alice', 'Bob', 'Chloé', 'Erwann', 'Grace', 'Linus'])
    expect(tests.filter((t) => t.name.startsWith('createUser accepte'))).toHaveLength(3)
  })
  it('(2) exécutions répétées identiques : seul le test aux arguments non déterministes est FLAKY', () => {
    const flaky = ctx.reader.tests(runId).filter((t) => t.flaky)
    expect(flaky.map((t) => [t.name, t.flakyReasons])).toEqual([
      ['echoValue renvoie un horodatage', ['NON_DETERMINISTIC_INPUT']],
    ])
  })
  it('profondeurs 0 et 1, transitif non muté, appel interne au module non observé (listé)', () => {
    const cs = ctx.reader.callSites(runId)
    expect(cs.filter((c) => c.export === 'inner').map((c) => c.depth)).toEqual([1, 1])
    expect(cs.filter((c) => c.export === 'outer').map((c) => c.depth)).toEqual([0, 0])
    expect(cs.some((c) => c.export === 'helper')).toBe(false)
    const targets = ctx.reader.targets(runId)
    expect(targets.find((t) => t.export === 'helper')?.status).toBe('NEVER_CALLED')
    expect(targets.find((t) => t.export === 'inner')?.status).toBe('TRANSITIVE_ONLY')
    expect(plan.mutations.some((m) => m.export === 'inner')).toBe(false)
  })
})

describe('custom (3) (4) (8) (9) : classification par rejeu', () => {
  const replay = (m: PlannedMutation) => replayMutation(ctx, m.id)
  it('(3) (4) null ⇒ HANDLED, {} ⇒ CRASH (TypeError), "" ⇒ HANDLED ; test en échec dans les trois cas', async () => {
    const out = []
    for (const value of [null, {}, ''])
      out.push(
        (await replay(pick({ export: 'createUser', test: VALID, pathStr: 'arg0.name', value })))
          .classification,
      )
    expect(out.map((c) => c.status)).toEqual(['HANDLED', 'CRASH', 'HANDLED'])
    expect(out.map((c) => c.testStatus)).toEqual(['failed', 'failed', 'failed'])
    expect(out[1]?.error?.constructorChain).toContain('TypeError')
  })
  it('(3) écho d’une valeur d’un autre type ⇒ SUSPICIOUS_ACCEPT / ECHO ; null renvoyé ⇒ pas d’ECHO', async () => {
    const T = 'echoValue renvoie sa valeur'
    const echo = (
      await replay(
        pick({ export: 'echoValue', test: T, pathStr: 'arg0', strategy: 'type', value: {} }),
      )
    ).classification
    const nul = (await replay(pick({ export: 'echoValue', test: T, pathStr: 'arg0', value: null })))
      .classification
    expect([echo.subtype, echo.reason, echo.echoPath]).toEqual([
      'SUSPICIOUS_ACCEPT',
      'ECHO',
      'return.received',
    ])
    expect([nul.status, nul.subtype]).toEqual(['PASSED', undefined])
  })
  it('(8) rejet, levée synchrone et retour résolu distingués', async () => {
    const out = []
    for (const value of ['7', {}])
      out.push((await replay(pick({ export: 'fetchUser', pathStr: 'arg0', value }))).classification)
    const positive = plan.mutations.find(
      (m) => m.export === 'fetchUser' && Number.isInteger(m.value) && (m.value as number) > 0,
    )
    if (!positive) throw new Error('aucun entier positif planifié pour fetchUser')
    out.push((await replay(positive)).classification)
    expect(out.map((c) => [c.outcome, c.status])).toEqual([
      ['reject', 'HANDLED'],
      ['throw', 'CRASH'],
      ['return', 'PASSED'],
    ])
  })
  it('(8) rejet non géré après un retour normal ⇒ CRASH / UNHANDLED_REJECTION', async () => {
    const c = (
      await replay(pick({ export: 'scheduleWelcome', pathStr: 'arg0.email', value: null }))
    ).classification
    expect([c.status, c.subtype, c.error?.name]).toEqual([
      'CRASH',
      'UNHANDLED_REJECTION',
      'TypeError',
    ])
  })
  it('(9) seule la 2ᵉ des trois occurrences est mutée, les autres gardent leur empreinte', async () => {
    const m = pick({
      export: 'createUser',
      test: 'createUser crée trois utilisateurs',
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
  })
})

describe('custom (5) (10) : plan, empreinte divergente', () => {
  it('(5) même graine ⇒ plan identique octet pour octet, y compris après une nouvelle baseline', async () => {
    const again = readFileSync(planRun(ctx, runId).planPath)
    const b2 = await runBaseline(ctx)
    const third = readFileSync(planRun(ctx, b2.runId).planPath)
    expect(planBytes.equals(again)).toBe(true)
    expect(planBytes.equals(third)).toBe(true)
    expect(plan.mutations.filter((m) => m.export === 'repeat')).toHaveLength(3)
  })
  it('(10) mutation forcée sur le call site non déterministe ⇒ SKIPPED / AMBIGUOUS_CALL_SITE', async () => {
    const b = await runBaseline(ctx)
    const test = ctx.reader.tests(b.runId).find((t) => t.name === 'echoValue renvoie un horodatage')
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
    const base = readPlan(planRun(ctx, b.runId).planPath)
    savePlan(ctx, b.runId, { ...base, possible: 1, mutations: [forced] })
    await runFuzz(ctx, b.runId)
    expect(ctx.reader.results(b.runId).map((r) => [r.mutationId, r.status, r.reason])).toEqual([
      [forced.id, 'SKIPPED', 'AMBIGUOUS_CALL_SITE'],
    ])
  })
})

afterAll(() => {
  ctx.close()
  // (12) Projet inchangé (git et manifeste) après tous les scénarios de ce fichier.
  expect(diffSnapshots(before.git, gitSnapshot(CUSTOM))).toEqual([])
  expect(diffSnapshots(before.manifest, manifestSnapshot(CUSTOM))).toEqual([])
})
