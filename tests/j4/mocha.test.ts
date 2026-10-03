// R-01 : scénarios d'acceptation du §5 (J4) sur examples/mocha-project, via le VRAI CLI.
// (1) baseline et observation, (2) stabilité, (3) HANDLED / CRASH / ECHO, (4) statut du test sans
// influence, (5) plan identique octet pour octet, (8) rejet / levée / retour et rejet non géré,
// (9) une seule occurrence mutée, (10) empreinte divergente, (12) projet inchangé.
// Les scénarios (6) (7) (11) (13) (14) sont dans mocha-process.test.ts.
import type { PlannedMutation } from '@varia/core'
import { diffSnapshots, gitSnapshot, manifestSnapshot, mutationId } from '@varia/core'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { json, newDataDir, varia, withReader } from '../j1/helpers.js'

export const MOCHA = resolve('examples/mocha-project')

interface Replay {
  classification: {
    status: string
    subtype?: string
    reason?: string
    outcome?: string
    testStatus: string | null
    echoPath?: string
    error?: { name: string; constructorChain: string[] }
  }
  calls: { export: string; sequence: number; argsFingerprint: string; mutated: boolean }[]
}

const D = newDataDir()
const before = { git: gitSnapshot(MOCHA), manifest: manifestSnapshot(MOCHA) }
let plan: { mutations: PlannedMutation[] }
const VALID = 'createUser crée un utilisateur valide'
const cli = (args: string[]) => varia(['--data-dir', D, ...args], MOCHA)

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
const replay = async (m: PlannedMutation) => {
  const r = await cli(['--json', 'replay', m.id])
  expect(r.code, r.err).toBe(0)
  return json<Replay>(r)
}

beforeAll(async () => {
  const b = await cli(['baseline'])
  expect(b.code, b.err).toBe(0)
  const p = await cli(['--json', 'plan', '--out', join(D, 'plan-a.json')])
  expect(p.code, p.err).toBe(0)
  plan = JSON.parse(readFileSync(join(D, 'plan-a.json'), 'utf8')) as typeof plan
})

describe('Mocha (1) (2) : baseline, observation, stabilité', () => {
  it('(1) 13 tests verts, appels createUser observés avec leurs arguments', () => {
    withReader(D, (r) => {
      const run = r.listRuns(1)[0]
      const tests = r.tests(run?.id ?? '')
      expect(tests).toHaveLength(13)
      expect(tests.every((t) => t.status === 'passed')).toBe(true)
      const names = r
        .callSites(run?.id ?? '')
        .filter((c) => c.export === 'createUser')
        .map((c) => (c.args as Record<string, unknown>[])[0]?.['name'])
      expect(names.sort()).toEqual(['Ada', 'Alice', 'Bob', 'Chloé', 'Erwann', 'Grace', 'Linus'])
      // Test paramétré : trois tests Mocha distincts.
      expect(tests.filter((t) => t.name.startsWith('createUser accepte'))).toHaveLength(3)
    })
  })
  it('(2) exécutions répétées identiques : seul le test aux arguments non déterministes est FLAKY', () => {
    withReader(D, (r) => {
      const flaky = r.tests(r.listRuns(1)[0]?.id ?? '').filter((t) => t.flaky)
      expect(flaky.map((t) => [t.name, t.flakyReasons])).toEqual([
        ['echoValue renvoie un horodatage', ['NON_DETERMINISTIC_INPUT']],
      ])
    })
  })
  it('profondeurs 0 et 1, transitif non muté, appel interne au module non observé (listé)', () => {
    withReader(D, (r) => {
      const id = r.listRuns(1)[0]?.id ?? ''
      const cs = r.callSites(id)
      expect(cs.filter((c) => c.export === 'inner').map((c) => c.depth)).toEqual([1, 1])
      expect(cs.filter((c) => c.export === 'outer').map((c) => c.depth)).toEqual([0, 0])
      expect(cs.some((c) => c.export === 'helper')).toBe(false)
      expect(r.targets(id).find((t) => t.export === 'helper')?.status).toBe('NEVER_CALLED')
      expect(r.targets(id).find((t) => t.export === 'inner')?.status).toBe('TRANSITIVE_ONLY')
    })
    expect(plan.mutations.some((m) => m.export === 'inner')).toBe(false)
  })
})

describe('Mocha (5) : plan', () => {
  it('même graine ⇒ plan identique octet pour octet, y compris après une nouvelle baseline', async () => {
    expect((await cli(['-q', 'plan', '--out', join(D, 'plan-b.json')])).code).toBe(0)
    expect((await cli(['-q', 'baseline'])).code).toBe(0)
    expect((await cli(['-q', 'plan', '--out', join(D, 'plan-c.json')])).code).toBe(0)
    const a = readFileSync(join(D, 'plan-a.json'))
    expect(a.equals(readFileSync(join(D, 'plan-b.json')))).toBe(true)
    expect(a.equals(readFileSync(join(D, 'plan-c.json')))).toBe(true)
    expect(plan.mutations.filter((m) => m.export === 'repeat')).toHaveLength(3)
  })
})

describe('Mocha (3) (4) (8) (9) : classification via `varia replay`', () => {
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
    const base = withReader(D, (rd) =>
      rd
        .callSites(rd.listRuns(1)[0]?.id ?? '')
        .filter((c) => c.testId === m.testId)
        .sort((a, b) => a.sequence - b.sequence),
    )
    expect(calls.map((c) => c.argsFingerprint)).toEqual(base.map((c) => c.argsFingerprint))
  })
})

describe('Mocha (10) : empreinte divergente', () => {
  it('`varia fuzz --plan` sur le call site non déterministe ⇒ SKIPPED / AMBIGUOUS_CALL_SITE', async () => {
    const forced = withReader(D, (r) => {
      const runId = r.listRuns(1)[0]?.id ?? ''
      const test = r.tests(runId).find((t) => t.name === 'echoValue renvoie un horodatage')
      const site = r
        .callSites(runId)
        .find((c) => c.testId === test?.testId && c.export === 'echoValue')
      if (!test || !site) throw new Error('call site introuvable')
      const m: PlannedMutation = {
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
      return m
    })
    const file = join(D, 'forced.json')
    writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        variaVersion: '0.1.0',
        seed: 1,
        configHash: '',
        possible: 1,
        mutations: [forced],
      }),
    )
    const report = json<{ mutations: { id: string; status: string; reason: string }[] }>(
      await cli(['--json', 'fuzz', '--plan', file]),
    )
    expect(report.mutations).toEqual([
      expect.objectContaining({ id: forced.id, status: 'SKIPPED', reason: 'AMBIGUOUS_CALL_SITE' }),
    ])
  })
})

afterAll(() => {
  // (12) Projet inchangé (git et manifeste) après toutes les commandes de ce fichier.
  expect(diffSnapshots(before.git, gitSnapshot(MOCHA))).toEqual([])
  expect(diffSnapshots(before.manifest, manifestSnapshot(MOCHA))).toEqual([])
})
