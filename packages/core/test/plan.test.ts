import { describe, expect, it } from 'vitest'
import { buildCatalog, pathString } from '../src/catalog.js'
import {
  generatePlan,
  mutationId,
  selectPerInput,
  serializePlan,
  type PlannedMutation,
} from '../src/plan.js'
import { mulberry32, shuffle } from '../src/rng.js'
import { call, planOptions } from './fixtures.js'

describe('mulberry32', () => {
  it('déterministe, dépend de la graine, valeur de référence', () => {
    const a = mulberry32(1)
    const b = mulberry32(1)
    const xs = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(xs)
    expect(mulberry32(2)()).not.toBe(xs[0])
    expect(mulberry32(42)()).toBeCloseTo(0.6011037519201636, 12)
  })
  it('shuffle ne modifie pas l’entrée', () => {
    const input = [1, 2, 3, 4, 5]
    expect([...shuffle(input, mulberry32(3))].sort()).toEqual(input)
    expect(input).toEqual([1, 2, 3, 4, 5])
  })
})

describe('catalogue', () => {
  it('chemins, types, masqué non mutable, transitifs ignorés', () => {
    const cat = buildCatalog([call(), call({ callSiteId: 'c_2', depth: 1 })])
    expect(cat.map((i) => [i.pathStr, i.type, i.mutable])).toEqual([
      ['arg0', 'object', true],
      ['arg0.name', 'string', true],
      ['arg0.age', 'number', true],
      ['arg0.password', 'string', false],
    ])
    expect(cat[3]?.reason).toBe('REDACTED')
  })
  it('skip, hints, bornes déclarées puis observées, formats', () => {
    const calls = [call(), call({ callSiteId: 'c_2', args: [{ name: 'a@b.co', age: 9 }] })]
    const cat = buildCatalog(calls, {
      skip: ['f#arg0.name'],
      hints: [{ path: 'f#arg0.age', range: [0, 150] }],
    })
    expect(cat.find((i) => i.pathStr === 'arg0.name')?.reason).toBe('SKIPPED_BY_CONFIG')
    expect(cat.find((i) => i.pathStr === 'arg0.age')?.bounds).toEqual({
      min: 0,
      max: 150,
      provenance: 'declared',
    })
    const noHint = buildCatalog(calls)
    expect(noHint.find((i) => i.pathStr === 'arg0.age')?.bounds).toEqual({
      min: 3,
      max: 9,
      provenance: 'observed',
    })
    expect(noHint.find((i) => i.callSiteId === 'c_2' && i.pathStr === 'arg0.name')?.format).toBe(
      'email',
    )
  })
  it('opaques, tableaux, objets étiquetés', () => {
    const cat = buildCatalog([
      call({
        args: [
          { $t: 'opaque', kind: 'function' },
          [1, 2],
          { $t: 'object', ctor: 'U', v: { k: 1 } },
        ],
      }),
    ])
    expect(cat.map((i) => [i.pathStr, i.mutable])).toEqual([
      ['arg0', false],
      ['arg1', true],
      ['arg1[0]', true],
      ['arg1[1]', true],
      ['arg2', true],
      ['arg2.k', true],
    ])
    expect(cat[0]?.reason).toBe('OPAQUE')
  })
  it('pathString', () => expect(pathString(['0', 'items', '2', 'id'])).toBe('arg0.items[2].id'))
})

describe('plan', () => {
  const plan = (over = {}) => generatePlan(buildCatalog([call()]), planOptions(over))
  it('trié par identifiant, sans doublon, jamais la valeur d’origine', () => {
    const p = plan()
    const ids = p.mutations.map((m) => m.id)
    expect(ids).toEqual([...ids].sort())
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of p.mutations)
      expect(JSON.stringify(m.value)).not.toBe(JSON.stringify(m.original))
  })
  it('identique octet à octet pour la même graine ; la graine change le tirage', () => {
    expect(serializePlan(plan())).toBe(serializePlan(plan()))
    expect(plan({ seed: 1, perInput: 12 }).mutations.map((m) => m.id)).not.toEqual(
      plan({ seed: 2, perInput: 12 }).mutations.map((m) => m.id),
    )
  })
  it('possible ≥ retenues ; plafonds par target et global', () => {
    const p = plan()
    expect(p.possible).toBeGreaterThan(p.mutations.length)
    expect(plan({ perTarget: { 'src/a.js#f': 5 } }).mutations).toHaveLength(5)
    expect(plan({ total: 2 }).mutations).toHaveLength(2)
  })
  it('valeurs déclarées, tests exclus', () => {
    expect(
      plan({ perInput: 50, extraValues: { 'f#arg0.name': ['boom'] } }).mutations.some(
        (m) => m.strategy === 'declared',
      ),
    ).toBe(true)
    expect(plan({ excludeTests: new Set(['t_1']) }).mutations).toEqual([])
  })
  it('mutationId stable', () => {
    expect(mutationId('c', 'arg0', 'null', 'set', null)).toBe(
      mutationId('c', 'arg0', 'null', 'set', null),
    )
    expect(mutationId('c', 'arg0', 'null', 'set', null)).not.toBe(
      mutationId('c', 'arg1', 'null', 'set', null),
    )
  })
})

describe('selectPerInput (CDC §13.4)', () => {
  const ms = (specs: [string, string][]) =>
    specs.map(
      ([strategy, mutatedType], i) => ({ id: String(i), strategy, mutatedType }) as PlannedMutation,
    )
  it('une par stratégie, puis diversité des types', () => {
    const picked = selectPerInput(
      ms([
        ['a', 'x'],
        ['a', 'x'],
        ['a', 'y'],
        ['b', 'x'],
        ['c', 'x'],
      ]),
      4,
      mulberry32(1),
    )
    expect(new Set(picked.map((m) => m.strategy))).toEqual(new Set(['a', 'b', 'c']))
    expect(picked.map((m) => m.id)).toContain('2')
  })
  it('priorité à l’historique de crash', () => {
    const all = ms([
      ['a', 'x'],
      ['b', 'x'],
      ['c', 'x'],
    ])
    expect(selectPerInput(all, 1, mulberry32(1), new Set(['2'])).map((m) => m.id)).toEqual(['2'])
  })
  it('sous la limite : tout', () =>
    expect(selectPerInput(ms([['a', 'x']]), 3, mulberry32(1))).toHaveLength(1))
})
