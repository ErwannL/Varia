import { describe, expect, it } from 'vitest'
import { buildCatalog, pathString } from '../src/catalog.js'
import type { ObservedCall } from '../src/observe.js'
import {
  generatePlan,
  mutationId,
  selectPerInput,
  serializePlan,
  type PlannedMutation,
} from '../src/plan.js'
import { mulberry32, shuffle } from '../src/rng.js'

const call = (over: Partial<ObservedCall> = {}): ObservedCall => ({
  callId: 1,
  callSiteId: 'c_1',
  testId: 't_1',
  module: 'src/a.js',
  export: 'f',
  depth: 0,
  sequence: 0,
  argsFingerprint: 'fp',
  args: [{ name: 'x', age: 3, password: { $redacted: true, fingerprint: 'h', type: 'string' } }],
  mutated: false,
  outcome: { kind: 'return', async: false },
  ...over,
})
const tests = new Map([['t_1', { file: 'tests/a.test.js', name: 'a' }]])

describe('mulberry32', () => {
  it('est déterministe et dépend de la graine', () => {
    const a = mulberry32(1)
    const b = mulberry32(1)
    const c = mulberry32(2)
    const xs = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(xs)
    expect(c()).not.toBe(xs[0])
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
  })
  it('valeur de référence (graine 42)', () => {
    expect(mulberry32(42)()).toBeCloseTo(0.6011037519201636, 12)
  })
  it('shuffle ne modifie pas l’entrée', () => {
    const input = [1, 2, 3, 4, 5]
    const out = shuffle(input, mulberry32(3))
    expect(input).toEqual([1, 2, 3, 4, 5])
    expect([...out].sort()).toEqual(input)
  })
})

describe('catalogue', () => {
  it('chemins, types, champ masqué non mutable, depth > 0 ignoré', () => {
    const cat = buildCatalog([call(), call({ callSiteId: 'c_2', depth: 1 })])
    expect(cat.map((i) => [i.pathStr, i.type, i.mutable])).toEqual([
      ['arg0', 'object', true],
      ['arg0.name', 'string', true],
      ['arg0.age', 'number', true],
      ['arg0.password', 'string', false],
    ])
    expect(cat[3]?.reason).toBe('REDACTED')
  })
  it('inputs.skip', () => {
    const cat = buildCatalog([call()], ['f#arg0.age'])
    expect(cat.find((i) => i.pathStr === 'arg0.age')?.reason).toBe('SKIPPED_BY_CONFIG')
  })
  it('pathString', () => {
    expect(pathString(['0', 'items', '2', 'id'])).toBe('arg0.items[2].id')
  })
})

describe('plan', () => {
  const plan = () => generatePlan(buildCatalog([call()]), { seed: 9, perInput: 4, tests })
  it('trié par identifiant, sans doublon', () => {
    const ids = plan().mutations.map((m) => m.id)
    expect(ids).toEqual([...ids].sort())
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('la graine change le tirage au-delà d’une mutation par stratégie', () => {
    const sel = (seed: number) =>
      generatePlan(buildCatalog([call()]), { seed, perInput: 7, tests }).mutations.map((m) => m.id)
    expect(sel(1)).not.toEqual(sel(2))
  })
  it('identique octet à octet pour la même graine', () => {
    expect(serializePlan(plan())).toBe(serializePlan(plan()))
  })
  it('plafond par input et par target', () => {
    const p = generatePlan(buildCatalog([call()]), {
      seed: 9,
      perInput: 4,
      tests,
      perTarget: { 'src/a.js#f': 5 },
    })
    expect(p.mutations).toHaveLength(5)
  })
  it('n’inclut jamais la valeur d’origine', () => {
    for (const m of plan().mutations)
      expect(JSON.stringify(m.value)).not.toBe(JSON.stringify(m.original))
  })
  it('valeurs déclarées', () => {
    const p = generatePlan(buildCatalog([call()]), {
      seed: 9,
      perInput: 20,
      tests,
      extraValues: { 'f#arg0.name': ['boom'] },
    })
    expect(p.mutations.some((m) => m.strategy === 'declared' && m.value === 'boom')).toBe(true)
  })
  it('tests exclus', () => {
    expect(
      generatePlan(buildCatalog([call()]), {
        seed: 9,
        perInput: 4,
        tests,
        excludeTests: new Set(['t_1']),
      }).mutations,
    ).toEqual([])
  })
  it('mutationId stable', () => {
    expect(mutationId('c', 'arg0', 'null', 'set', null)).toBe(
      mutationId('c', 'arg0', 'null', 'set', null),
    )
    expect(mutationId('c', 'arg0', 'null', 'set', null)).not.toBe(
      mutationId('c', 'arg1', 'null', 'set', null),
    )
  })
  it('sélection : une mutation par stratégie avant le tirage', () => {
    const ms = ['a', 'a', 'a', 'b', 'c'].map(
      (strategy, i) => ({ id: String(i), strategy }) as PlannedMutation,
    )
    expect(new Set(selectPerInput(ms, 3, mulberry32(1)).map((m) => m.strategy))).toEqual(
      new Set(['a', 'b', 'c']),
    )
  })
})
