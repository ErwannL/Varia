import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Observation } from '../src/observe.js'
import { serializePlan } from '../src/plan.js'
import type { JestRun } from '../src/runner.js'
import type { Spike } from '../src/spike.js'
import { newDataDir, newSpike, PLAN_OPTIONS } from './helpers.js'

const PASSWORDS = [
  'hunter2-secret',
  'pw-ada-secret',
  'pw-grace-secret',
  'pw-linus-secret',
  'pw-each-secret',
]

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? allFiles(p) : [p]
  })
}

let dataDir: string
let spike: Spike
let first: { run: JestRun; observation: Observation }
let second: Observation

beforeAll(async () => {
  dataDir = newDataDir()
  spike = newSpike(dataDir)
  first = await spike.baseline(true)
  second = (await spike.baseline()).observation
})

afterAll(() => spike.dispose())

describe('J0-1 baseline', () => {
  it('100 % des tests passent', () => {
    expect(first.run.report?.numTotalTests).toBe(12)
    expect(first.observation.tests.every((t) => t.status === 'passed')).toBe(true)
  })
  it('les appels à createUser sont observés avec leurs arguments', () => {
    const calls = first.observation.calls.filter((c) => c.export === 'createUser')
    expect(calls).toHaveLength(7)
    const names = calls.map((c) => (c.args?.[0] as Record<string, unknown>)['name'])
    expect(names).toEqual(['Erwann', 'Ada', 'Grace', 'Linus', 'Alice', 'Bob', 'Chloé'])
    expect((calls[0]?.args?.[0] as Record<string, unknown>)['age']).toBe(25)
  })
})

describe('J0-2 stabilité', () => {
  it('aucune différence hors du test non déterministe, qui est FLAKY', async () => {
    const { compareBaselines } = await import('../src/observe.js')
    const result = compareBaselines(first.observation, second)
    expect(result.flaky.map((f) => f.name)).toEqual(['echoValue renvoie un horodatage'])
    expect(result.flaky[0]?.reasons).toEqual(['NON_DETERMINISTIC_INPUT'])
  })
  it('détecte un changement de call sites', async () => {
    const { compareBaselines } = await import('../src/observe.js')
    const truncated = { ...second, calls: second.calls.filter((c) => c.export !== 'repeat') }
    const result = compareBaselines(first.observation, truncated)
    expect(result.flaky.find((f) => f.name === 'repeat termine')?.reasons).toEqual([
      'CALL_SITES_CHANGED',
    ])
  })
})

describe('J0-7 déterminisme du plan', () => {
  it('même graine, deux runs complets : plans identiques octet à octet', async () => {
    const other = newSpike(dataDir)
    const third = (await other.baseline()).observation
    other.dispose()
    const flaky = new Set(
      (await import('../src/observe.js'))
        .compareBaselines(first.observation, second)
        .flaky.map((f) => f.testId),
    )
    const a = serializePlan(spike.plan(first.observation, { ...PLAN_OPTIONS, excludeTests: flaky }))
    const b = serializePlan(spike.plan(third, { ...PLAN_OPTIONS, excludeTests: flaky }))
    expect(a.length).toBeGreaterThan(1000)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
    expect(a).not.toMatch(/"timestamp"|"runId"|r_[0-9a-f]{12}/)
  })
  it('une autre graine change la sélection', () => {
    const a = serializePlan(spike.plan(first.observation, { ...PLAN_OPTIONS, perInput: 8 }))
    const b = serializePlan(
      spike.plan(first.observation, { ...PLAN_OPTIONS, perInput: 8, seed: 7 }),
    )
    expect(a).not.toBe(b)
  })
})

describe('J0-11 redaction dans la sonde', () => {
  it('aucune valeur brute de mot de passe sur disque (journaux JSONL)', () => {
    const files = allFiles(first.run.runDir)
    expect(files.some((f) => f.endsWith('.jsonl'))).toBe(true)
    // Le cache de transformation Jest contient une copie du CODE SOURCE du projet (où le test écrit le
    // mot de passe en dur) : ce n'est pas une valeur observée. Voir DECISIONS D-007.
    const written = allFiles(dataDir).filter((f) => !f.includes(`${sep}jest-cache${sep}`))
    for (const f of [...files, ...written]) {
      const content = readFileSync(f, 'utf8')
      for (const p of PASSWORDS) expect(content.includes(p), `${p} dans ${f}`).toBe(false)
    }
  })
  it('le champ masqué porte une empreinte et son type', () => {
    const call = first.observation.calls.find((c) => c.export === 'createUser')
    const pw = (call?.args?.[0] as Record<string, Record<string, unknown>>)['password']
    expect(pw?.['$redacted']).toBe(true)
    expect(pw?.['type']).toBe('string')
    expect(String(pw?.['fingerprint'])).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('J0-15 test.each', () => {
  it('trois tests distincts aux testId stables entre deux runs', () => {
    const each = (o: Observation) => o.tests.filter((t) => t.name.startsWith('createUser accepte'))
    const ids = each(first.observation).map((t) => t.testId)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    expect(each(second).map((t) => t.testId)).toEqual(ids)
    const sites = first.observation.calls
      .filter((c) => ids.includes(c.testId))
      .map((c) => c.callSiteId)
    expect(new Set(sites).size).toBe(3)
  })
})

describe('J0-16 profondeur', () => {
  it('outer depth 0 et inner depth 1, avec appels async entrelacés', () => {
    const calls = first.observation.calls.filter(
      (c) => c.export === 'outer' || c.export === 'inner',
    )
    expect(calls.map((c) => [c.export, c.depth, c.sequence]).sort()).toEqual([
      ['inner', 1, 0],
      ['inner', 1, 1],
      ['outer', 0, 0],
      ['outer', 0, 1],
    ])
  })
  it('les appels transitifs ne sont pas catalogués (targets.depth: direct)', () => {
    expect(spike.catalog(first.observation).some((i) => i.export === 'inner')).toBe(false)
  })
})

describe('J0-17 appel interne au même module', () => {
  it('helper (appelé par sumLocal sans passer par exports) n’est pas observé mais est découvert', () => {
    expect(first.observation.calls.some((c) => c.export === 'helper')).toBe(false)
    expect(first.observation.calls.some((c) => c.export === 'sumLocal')).toBe(true)
    expect(first.observation.discovered['src/math.js']?.wrapped).toContain('helper')
  })
})
