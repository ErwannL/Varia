import { describe, expect, it } from 'vitest'
import {
  deserialize,
  fingerprint,
  serialize,
  stableStringify,
  typeOfSerialized,
} from '../src/index.js'

const roundTrip = (v: unknown) => deserialize(serialize(v) as never)

describe('valeurs étiquetées (CDC §10.7)', () => {
  it.each([
    [undefined, { $t: 'undefined' }],
    [NaN, { $t: 'number', v: 'NaN' }],
    [Infinity, { $t: 'number', v: 'Infinity' }],
    [-Infinity, { $t: 'number', v: '-Infinity' }],
    [-0, { $t: 'number', v: '-0' }],
    [10n, { $t: 'bigint', v: '10' }],
    [new Date(0), { $t: 'date', v: '1970-01-01T00:00:00.000Z' }],
    [new Date(NaN), { $t: 'date', v: null }],
    [/a+/g, { $t: 'regexp', source: 'a+', flags: 'g' }],
    [Buffer.from('hi'), { $t: 'bytes', kind: 'Buffer', base64: 'aGk=' }],
  ])('%s', (value, expected) => {
    expect(serialize(value)).toEqual(expected)
  })
  it('aller-retour', () => {
    expect(Object.is(roundTrip(-0), -0)).toBe(true)
    expect(roundTrip(new Map([[1, 'a']]))).toEqual(new Map([[1, 'a']]))
    expect(roundTrip(new Set([1]))).toEqual(new Set([1]))
    expect(roundTrip({ $t: 'collision' })).toEqual({ $t: 'collision' })
    const sparse: number[] = []
    sparse[0] = 1
    sparse[2] = 3
    const back = roundTrip(sparse) as number[]
    expect(back).toHaveLength(3)
    expect(1 in back).toBe(false)
    expect(roundTrip(undefined)).toBeUndefined()
  })
  it('opaques, circulaires, profondeur', () => {
    const a: Record<string, unknown> = {}
    a['self'] = a
    expect(serialize(a)).toEqual({ self: { $t: 'circular' } })
    expect(serialize(() => 1)).toMatchObject({ $t: 'opaque', kind: 'function' })
    expect(serialize({ a: { b: { c: 1 } } }, { maxDepth: 2 })).toEqual({
      a: { b: { $t: 'truncated', type: 'object' } },
    })
    expect(serialize(Promise.resolve())).toEqual({ $t: 'opaque', kind: 'Promise' })
  })
  it('instance de classe : constructeur conservé', () => {
    class User {
      name = 'x'
    }
    expect(serialize(new User())).toEqual({ $t: 'object', ctor: 'User', v: { name: 'x' } })
  })
  it('redaction : jamais la valeur brute, empreinte HMAC, collecte du secret', () => {
    const secrets: string[] = []
    const out = serialize(
      { Password: 'abc' },
      { redactFields: new Set(['password']), hmacKey: 'k', secrets },
    )
    expect(JSON.stringify(out)).not.toContain('abc')
    expect(secrets).toEqual(['abc'])
    const other = serialize(
      { Password: 'abc' },
      { redactFields: new Set(['password']), hmacKey: 'k2' },
    )
    expect(other).not.toEqual(out)
  })
  it('stableStringify trie les clés ; empreinte indépendante de l’ordre', () => {
    expect(stableStringify({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}')
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }))
  })
  it('typeOfSerialized', () => {
    expect(
      [
        null,
        [],
        'x',
        1,
        { a: 1 },
        { $t: 'undefined' },
        { $redacted: true, type: 'string' },
        { $t: 'date' },
      ].map((v) => typeOfSerialized(v as never)),
    ).toEqual(['null', 'array', 'string', 'number', 'object', 'undefined', 'string', 'date'])
  })
})
