// Acceptation J1-1 : les scénarios J0 restent verts, désormais via le vrai CLI (`varia …`).
import type { PlannedMutation } from '@varia/core'
import { diffSnapshots, gitSnapshot, manifestSnapshot, mutationId } from '@varia/core'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { EXAMPLE, json, newDataDir, projectDir, varia, withReader } from './helpers.js'

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
  calls: {
    callSiteId: string
    export: string
    sequence: number
    argsFingerprint: string
    mutated: boolean
  }[]
}

const D = newDataDir()
const before = { git: gitSnapshot(EXAMPLE), manifest: manifestSnapshot(EXAMPLE) }
let plan: { mutations: PlannedMutation[] }
const VALID = 'createUser crée un utilisateur valide'

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
  const r = await varia(['--data-dir', D, '--json', 'replay', m.id])
  expect(r.code, r.err).toBe(0)
  return json<Replay>(r)
}

beforeAll(async () => {
  const b = await varia(['--data-dir', D, 'baseline'])
  expect(b.code, b.err).toBe(0)
  const p = await varia(['--data-dir', D, '--json', 'plan', '--out', join(D, 'plan-a.json')])
  expect(p.code, p.err).toBe(0)
  plan = JSON.parse(readFileSync(join(D, 'plan-a.json'), 'utf8')) as typeof plan
})

describe('baseline et observation (J0-1/2/11/15/16/17)', () => {
  it('J0-1 : 100 % verts, appels createUser observés avec leurs arguments', () => {
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
    })
  })
  it('J0-2 : seul le test non déterministe est FLAKY', () => {
    withReader(D, (r) => {
      const flaky = r.tests(r.listRuns(1)[0]?.id ?? '').filter((t) => t.flaky)
      expect(flaky.map((t) => [t.name, t.flakyReasons])).toEqual([
        ['echoValue renvoie un horodatage', ['NON_DETERMINISTIC_INPUT']],
      ])
    })
  })
  it('J0-11 : aucun mot de passe brut dans le stockage de Varia', () => {
    const all = (d: string): string[] =>
      readdirSync(d).flatMap((f) =>
        statSync(join(d, f)).isDirectory() ? all(join(d, f)) : [join(d, f)],
      )
    for (const f of all(projectDir(D))) {
      const c = readFileSync(f).toString('latin1')
      for (const p of [
        'hunter2-secret',
        'pw-ada-secret',
        'pw-grace-secret',
        'pw-linus-secret',
        'pw-each-secret',
      ])
        expect(c.includes(p), `${p} dans ${f}`).toBe(false)
    }
  })
  it('J0-15 : trois tests test.each distincts', () => {
    withReader(D, (r) =>
      expect(
        r.tests(r.listRuns(1)[0]?.id ?? '').filter((t) => t.name.startsWith('createUser accepte')),
      ).toHaveLength(3),
    )
  })
  it('J0-16 / J0-17 : profondeurs, transitifs non mutés, appel interne non observé', () => {
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

describe('plan (J0-7)', () => {
  it('même graine : plan identique octet à octet, y compris après une nouvelle baseline', async () => {
    expect(
      (await varia(['--data-dir', D, '-q', 'plan', '--out', join(D, 'plan-b.json')])).code,
    ).toBe(0)
    expect((await varia(['--data-dir', D, '-q', 'baseline'])).code).toBe(0)
    expect(
      (await varia(['--data-dir', D, '-q', 'plan', '--out', join(D, 'plan-c.json')])).code,
    ).toBe(0)
    const a = readFileSync(join(D, 'plan-a.json'))
    expect(a.equals(readFileSync(join(D, 'plan-b.json')))).toBe(true)
    expect(a.equals(readFileSync(join(D, 'plan-c.json')))).toBe(true)
    expect(a.toString()).not.toMatch(/"r_[0-9a-f]{12}"|timestamp/)
    expect(plan.mutations.filter((m) => m.export === 'repeat')).toHaveLength(3)
  })
})

describe('classification via `varia replay` (J0-3/4/5/6/8/9/12/14/18)', () => {
  it('J0-3/4/5/6 : null ⇒ HANDLED, {} ⇒ CRASH, "" ⇒ HANDLED, test en échec sans influence', async () => {
    const n = await replay(
      pick({ export: 'createUser', test: VALID, pathStr: 'arg0.name', value: null }),
    )
    const o = await replay(
      pick({ export: 'createUser', test: VALID, pathStr: 'arg0.name', value: {} }),
    )
    const e = await replay(
      pick({ export: 'createUser', test: VALID, pathStr: 'arg0.name', value: '' }),
    )
    expect([n.classification.status, o.classification.status, e.classification.status]).toEqual([
      'HANDLED',
      'CRASH',
      'HANDLED',
    ])
    expect([n.classification.testStatus, o.classification.testStatus]).toEqual(['failed', 'failed'])
    expect(o.classification.error?.constructorChain).toContain('TypeError')
  })
  it('J0-8 : repeat(count = null) ⇒ TIMEOUT', async () => {
    expect(
      (await replay(pick({ export: 'repeat', pathStr: 'arg1', value: null }))).classification
        .status,
    ).toBe('TIMEOUT')
  })
  it('J0-9 : exitOn("boom") ⇒ CRASH / PROCESS_EXIT', async () => {
    const r = await replay(pick({ export: 'exitOn', pathStr: 'arg0', value: 'boom' }))
    expect([r.classification.status, r.classification.subtype]).toEqual(['CRASH', 'PROCESS_EXIT'])
  })
  it('J0-12 : seul le 2ᵉ appel est muté, les autres gardent leur empreinte', async () => {
    const m = pick({
      export: 'createUser',
      test: 'createUser crée trois utilisateurs',
      pathStr: 'arg0.age',
      sequence: 1,
      value: '45',
    })
    const r = await replay(m)
    const calls = r.calls.filter((c) => c.export === 'createUser')
    expect(calls.map((c) => c.mutated)).toEqual([false, true, false])
    const base = withReader(D, (rd) =>
      rd
        .callSites(rd.listRuns(1)[0]?.id ?? '')
        .filter((c) => c.testId === m.testId)
        .sort((a, b) => a.sequence - b.sequence),
    )
    expect(calls.map((c) => c.argsFingerprint)).toEqual(base.map((c) => c.argsFingerprint))
  })
  it('J0-14 : rejet, levée synchrone et retour résolu distingués', async () => {
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
  it('J0-18 : {} renvoyé ⇒ ECHO ; null renvoyé ⇒ pas d’ECHO', async () => {
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
})

describe('J0-13 : empreinte différente ⇒ jamais appliquée', () => {
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
    const r = await varia(['--data-dir', D, '--json', 'fuzz', '--plan', file])
    const report = JSON.parse(r.out) as {
      mutations: { id: string; status: string; reason: string }[]
    }
    expect(report.mutations).toEqual([
      expect.objectContaining({ id: forced.id, status: 'SKIPPED', reason: 'AMBIGUOUS_CALL_SITE' }),
    ])
  })
})

describe('J0-10 : intégrité du projet exemple', () => {
  it('git et manifeste identiques après toutes les commandes', () => {
    expect(diffSnapshots(before.git, gitSnapshot(EXAMPLE))).toEqual([])
    expect(diffSnapshots(before.manifest, manifestSnapshot(EXAMPLE))).toEqual([])
  })
})
