// A-07 : chaque catalogue de valeurs est comparé, type par type, à la liste du CDC §13.3.
import type { Json } from '@varia/probe-protocol'
import { stableStringify } from '@varia/probe-runtime'
import { describe, expect, it } from 'vitest'
import { buildCatalog } from '../src/catalog.js'
import { generatePlan, mutationId, serializePlan } from '../src/plan.js'
import { candidatesFor, DEFAULT_CONTEXT, num, STRATEGY_IDS } from '../src/strategies/index.js'
import { call, input, planOptions } from './fixtures.js'

/** Toutes les valeurs (forme sérialisée) proposées, toutes stratégies confondues. */
const all = (original: Json, type: string, over = {}) =>
  new Set(
    candidatesFor(input(original, type, over), STRATEGY_IDS, DEFAULT_CONTEXT).map((c) =>
      c.op === 'delete' ? '<delete>' : stableStringify(c.value),
    ),
  )
const has = (set: Set<string>, values: Json[]) =>
  values.filter((v) => !set.has(stableStringify(v))).map((v) => stableStringify(v))

const UNDEF: Json = { $t: 'undefined' }
const long = 'x'.repeat(DEFAULT_CONTEXT.stringLength)

describe('catalogues du CDC §13.3', () => {
  it('String : "", " ", "123", "null", "true", emoji, accents (dont décomposé), CJK, contrôle, longue, autres types', () => {
    const got = all('hello', 'string')
    expect(
      has(got, [
        '',
        ' ',
        '123',
        'null',
        'true',
        '💀',
        'é',
        'é',
        '漢字',
        'abc\n',
        'abc\u0000',
        long,
        null,
        UNDEF,
        123,
        {},
        [],
        true,
      ]),
    ).toEqual([])
  })
  it('Number : 0, ±1, -0, 0.5, NaN, ±Infinity, MAX/MIN_VALUE, MAX_SAFE_INTEGER+1, "25", null, undefined, {}, []', () => {
    const got = all(25, 'number')
    expect(
      has(got, [
        0,
        1,
        -1,
        num(-0),
        0.5,
        num(NaN),
        num(Infinity),
        num(-Infinity),
        Number.MAX_VALUE,
        Number.MIN_VALUE,
        Number.MAX_SAFE_INTEGER + 1,
        '25',
        null,
        UNDEF,
        {},
        [],
      ]),
    ).toEqual([])
  })
  it('Boolean : 0, 1, "true", "false", null, undefined, {}, []', () => {
    expect(has(all(true, 'boolean'), [0, 1, 'true', 'false', null, UNDEF, {}, []])).toEqual([])
  })
  it('Array : [], [null], [""], [1], {}, "abc", null, [1,null,{}], grand, imbriqué, creux', () => {
    const got = all([7], 'array')
    const big = new Array<Json>(DEFAULT_CONTEXT.arrayLength).fill(7)
    expect(
      has(got, [
        [],
        [null],
        [''],
        [1],
        {},
        'abc',
        null,
        [1, null, {}],
        big,
        [[7]],
        [7, { $t: 'hole' }, 7],
      ]),
    ).toEqual([])
  })
  it('Object : {}, null, [], "abc", 123, propriétés en trop, imbrication profonde ; champ manquant/null/mal typé par champ', () => {
    const got = all({ a: 'x' }, 'object')
    let deep: Json = { leaf: 1 }
    for (let d = 0; d < DEFAULT_CONTEXT.objectDepth; d++) deep = { nested: deep }
    expect(
      has(got, [{}, null, [], 'abc', 123, { a: 'x', __varia_extra__: 'unexpected' }, deep]),
    ).toEqual([])
    // Le champ est lui-même un input : manquant (suppression), null, mal typé.
    const field = buildCatalog([call({ args: [{ a: 'x' }] })]).find((i) => i.pathStr === 'arg0.a')
    expect(field?.inObject).toBe(true)
    const f = all('x', 'string', { inObject: true })
    expect([f.has('<delete>'), f.has('null'), f.has('123')]).toEqual([true, true, true])
  })
  it('Date : invalide, extrême, null', () => {
    const got = all({ $t: 'date', v: '2020-01-01T00:00:00.000Z' }, 'date')
    expect(
      has(got, [{ $t: 'date', v: null }, { $t: 'date', v: '+275760-09-13T00:00:00.000Z' }, null]),
    ).toEqual([])
  })
  it('BigInt, Map, Set, Buffer : catalogues dédiés', () => {
    expect(
      has(all({ $t: 'bigint', v: '1' }, 'bigint'), [
        { $t: 'bigint', v: '0' },
        { $t: 'bigint', v: '-1' },
      ]),
    ).toEqual([])
    expect(
      has(all({ $t: 'map', entries: [] }, 'map'), [{ $t: 'map', entries: [] }, {}, null]),
    ).toEqual([])
    expect(
      has(all({ $t: 'set', values: [] }, 'set'), [{ $t: 'set', values: [] }, [], null]),
    ).toEqual([])
    expect(
      has(all({ $t: 'bytes', kind: 'Buffer', base64: 'aGk=' }, 'bytes'), [
        { $t: 'bytes', kind: 'Buffer', base64: '' },
        'abc',
        null,
      ]),
    ).toEqual([])
  })
})

describe('provenance des bornes (A-08)', () => {
  it('chaque mutation `boundary` porte sa provenance, jusque dans le plan', () => {
    const c = candidatesFor(
      input(5, 'number', { bounds: { min: 0, max: 150, provenance: 'declared' } }),
      ['boundary'],
      DEFAULT_CONTEXT,
    )
    expect(c.find((x) => x.value === 151)?.provenance).toBe('declared')
    expect(c.find((x) => x.value === 0.5)?.provenance).toBe('universal')
    // 0 est une borne déclarée ET universelle : la provenance la plus informative est gardée.
    expect(c.find((x) => x.value === 0)?.provenance).toBe('declared')
    const obs = candidatesFor(
      input('ab', 'string', { bounds: { min: 2, max: 2, provenance: 'observed' } }),
      ['boundary'],
      DEFAULT_CONTEXT,
    )
    expect(obs.map((x) => [x.value, x.provenance])).toEqual([
      ['a', 'observed'],
      ['aaa', 'observed'],
      ['', 'universal'],
      ['a', 'universal'],
    ])
    const plan = generatePlan(
      buildCatalog([call({ args: [{ age: 3 }] })], {
        hints: [{ path: 'f#arg0.age', range: [0, 9] }],
      }),
      planOptions({ perInput: 100, strategies: ['boundary', 'null'] }),
    )
    const boundary = plan.mutations.filter((m) => m.strategy === 'boundary')
    expect(boundary.find((m) => m.value === 10)?.provenance).toBe('declared')
    expect(boundary.every((m) => m.provenance !== undefined)).toBe(true)
    expect(
      plan.mutations.filter((m) => m.strategy === 'null').every((m) => !('provenance' in m)),
    ).toBe(true)
  })
})

describe('plan : commit git et clé __proto__ (A-09, A-01)', () => {
  it('le plan porte le commit (null hors dépôt), jamais l’empreinte d’environnement', () => {
    const cat = buildCatalog([call()])
    expect(generatePlan(cat, planOptions()).gitCommit).toBeNull()
    const p = generatePlan(cat, planOptions({ gitCommit: 'abc123' }))
    expect(p.gitCommit).toBe('abc123')
    expect(serializePlan(p)).toContain('"gitCommit": "abc123"')
    expect(serializePlan(p)).not.toMatch(/envHash|platform|process/)
  })
  it('aller-retour serializePlan → JSON.parse : clé __proto__ propre, identifiant distinct, aucune pollution', () => {
    const plan = generatePlan(
      buildCatalog([call({ args: [{ name: 'x' }] })]),
      planOptions({ perInput: 100, strategies: ['structure'] }),
    )
    const exotic = plan.mutations.find(
      (m) => m.pathStr === 'arg0' && stableStringify(m.value).includes('__proto__'),
    )
    expect(exotic).toBeDefined()
    const back = JSON.parse(serializePlan(plan)) as typeof plan
    const m = back.mutations.find((x) => x.id === exotic?.id)
    const fields = (m?.value as { v: Record<string, unknown> }).v
    expect(Object.getOwnPropertyNames(fields)).toContain('__proto__')
    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype)
    const withoutKey = { $t: 'object', v: { name: 'x' } }
    expect(m?.id).not.toBe(mutationId('c_1', 'arg0', 'structure', 'set', withoutKey))
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})
