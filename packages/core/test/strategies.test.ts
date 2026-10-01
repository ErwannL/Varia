import type { Json } from '@varia/probe-protocol'
import { describe, expect, it } from 'vitest'
import {
  candidatesFor,
  DEFAULT_CONTEXT,
  num,
  STRATEGIES,
  STRATEGY_IDS,
} from '../src/strategies/index.js'
import { input } from './fixtures.js'

const values = (original: Json, type: string, strategy: string, over = {}) =>
  candidatesFor(input(original, type, over), [strategy], DEFAULT_CONTEXT).map((c) =>
    c.op === 'delete' ? '<delete>' : c.value,
  )

describe('stratégies du §13.2', () => {
  it('les neuf stratégies garanties existent', () => {
    expect(STRATEGY_IDS).toEqual([
      'type',
      'null',
      'undefined',
      'empty',
      'boundary',
      'size',
      'structure',
      'format',
      'encoding',
    ])
  })
  it('type : familles voisines', () => {
    expect(values('x', 'string', 'type')).toEqual([123, true, {}, []])
    expect(values(25, 'number', 'type')).toEqual(['25', {}, [], true])
    expect(values(true, 'boolean', 'type')).toEqual([0, 1, 'true', 'false', {}, []])
    expect(values({ a: 1 }, 'object', 'type')).toEqual([[], 'abc', 123])
    expect(values([1], 'array', 'type')).toEqual([{}, 'abc', 0])
    expect(values({ $t: 'date', v: '2020-01-01T00:00:00.000Z' }, 'date', 'type')).toEqual([
      '2020-01-01',
      0,
    ])
    expect(values({ $t: 'bigint', v: '1' }, 'bigint', 'type')).toEqual([1, '1'])
  })
  it('null et undefined (dont propriété absente dans un objet)', () => {
    expect(values('x', 'string', 'null')).toEqual([null])
    expect(values(null, 'null', 'null')).toEqual([])
    expect(values('x', 'string', 'undefined')).toEqual([{ $t: 'undefined' }])
    expect(values('x', 'string', 'undefined', { inObject: true })).toEqual([
      { $t: 'undefined' },
      '<delete>',
    ])
  })
  it('empty', () => expect(values('x', 'string', 'empty')).toEqual(['', ' ', [], {}]))
  it('boundary : nombres, bornes observées et déclarées', () => {
    const v = values(5, 'number', 'boundary', {
      bounds: { min: 3, max: 9, provenance: 'observed' },
    })
    expect(v).toEqual(
      expect.arrayContaining([
        -1,
        0,
        1,
        num(-0),
        0.5,
        num(NaN),
        num(Infinity),
        num(-Infinity),
        2,
        10,
        3,
        9,
        Number.MAX_SAFE_INTEGER + 1,
      ]),
    )
  })
  it('boundary : longueurs de chaîne et de tableau', () => {
    expect(
      values('abc', 'string', 'boundary', { bounds: { min: 1, max: 3, provenance: 'declared' } }),
    ).toEqual(['', 'a', '', 'aaaa'])
    expect(
      values([7, 8], 'array', 'boundary', { bounds: { min: 2, max: 2, provenance: 'observed' } }),
    ).toEqual([[], [7], [7, 7, 7]])
    expect(values({ $t: 'date', v: null }, 'date', 'boundary')).toHaveLength(3)
    expect(values({ $t: 'bigint', v: '1' }, 'bigint', 'boundary')).toHaveLength(3)
  })
  it('size : plafonnée par les limites dures', () => {
    const [s] = values('x', 'string', 'size') as string[]
    expect(s).toHaveLength(DEFAULT_CONTEXT.stringLength)
    const [a] = values([1], 'array', 'size') as Json[][]
    expect(a).toHaveLength(DEFAULT_CONTEXT.arrayLength)
    const [o] = values({ a: 1 }, 'object', 'size')
    expect(JSON.stringify(o).split('nested').length - 1).toBe(DEFAULT_CONTEXT.objectDepth)
  })
  it('structure : champ ajouté, __proto__ propre, constructor, champ mal typé', () => {
    const v = values({ name: 'x' }, 'object', 'structure')
    expect(v).toHaveLength(4)
    expect(JSON.stringify(v[1])).toContain('"__proto__":{"polluted":true}')
    expect(v[3]).toEqual({ name: ['x'] })
    expect(values([1], 'array', 'structure')).toEqual([
      [[1]],
      [1, { $t: 'hole' }, 1],
      [1, null, {}],
    ])
  })
  it('format : seulement si reconnu ou déclaré', () => {
    expect(values('a@b.co', 'string', 'format', { format: 'email' })).toContain('user@')
    expect(values('hello', 'string', 'format')).toEqual([])
    expect(
      values('hello', 'string', 'format', { hint: { path: 'f#arg0', format: 'uuid' } }),
    ).toHaveLength(3)
  })
  it('encoding : chaînes uniquement', () => {
    expect(values('x', 'string', 'encoding')).toContain('‮abc')
    expect(values(1, 'number', 'encoding')).toEqual([])
  })
  it('chaque stratégie déclare un identifiant unique', () => {
    expect(new Set(STRATEGIES.map((s) => s.id)).size).toBe(STRATEGIES.length)
  })
})
