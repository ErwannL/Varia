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

describe('clé __proto__ : une donnée, jamais une écriture de prototype (A-01)', () => {
  // Construit comme le ferait JSON.parse : `__proto__` est une clé PROPRE.
  const exotic = () =>
    JSON.parse('{"a":1,"__proto__":{"polluted":true}}') as Record<string, unknown>
  it('stableStringify conserve la clé, triée', () => {
    expect(stableStringify(exotic())).toBe('{"__proto__":{"polluted":true},"a":1}')
    expect(fingerprint(exotic())).not.toBe(fingerprint({ a: 1 }))
  })
  it('sérialisation puis reconstruction : clé propre, prototype intact, aucune pollution', () => {
    const json = serialize(exotic())
    expect(Object.getOwnPropertyNames(json)).toContain('__proto__')
    const back = deserialize(json as never) as object
    expect(Object.getPrototypeOf(back)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(back, '__proto__')?.value).toEqual({ polluted: true })
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})

describe('valeurs limites de la sérialisation', () => {
  it('chaînes longues, symboles, erreurs, tableaux longs, octets sans constructeur', () => {
    expect(serialize('abcdef', { maxString: 3 })).toMatchObject({
      $t: 'string',
      truncated: true,
      length: 6,
    })
    expect(serialize(Symbol())).toEqual({ $t: 'symbol', v: '' })
    expect(serialize(Symbol('s'))).toEqual({ $t: 'symbol', v: 's' })
    expect(serialize(new TypeError('m'))).toEqual({ $t: 'error', name: 'TypeError', message: 'm' })
    expect(serialize([1, 2, 3], { maxItems: 2 })).toEqual({
      $t: 'array',
      truncated: true,
      length: 3,
      items: [1, 2],
    })
    const bytes = new Uint8Array([1])
    Object.setPrototypeOf(
      bytes,
      Object.create(Uint8Array.prototype, { constructor: { value: undefined } }),
    )
    expect(serialize(bytes)).toMatchObject({ $t: 'bytes', kind: 'Uint8Array' })
    expect(serialize(new Uint16Array([1]))).toMatchObject({ $t: 'bytes', kind: 'Uint16Array' })
  })
  it('objets à état externe opaques ; prototypes sans constructeur ; collisions d’étiquettes', () => {
    class Stream {
      pipe(): void {}
      emit(): void {}
    }
    expect(serialize(new Stream())).toEqual({ $t: 'opaque', kind: 'Stream' })
    const bare = Object.create(
      Object.create(null, { pipe: { value: () => 1 }, emit: { value: () => 1 } }),
    )
    expect(serialize(bare)).toEqual({ $t: 'opaque', kind: 'object' })
    const noCtor = Object.create(Object.create(null))
    noCtor.x = 1
    expect(serialize(noCtor)).toEqual({ $t: 'object', ctor: '', v: { x: 1 } })
    expect(serialize(Object.assign(Object.create(null), { a: 1 }))).toEqual({ a: 1 })
    expect(serialize({ $redacted: 1 })).toEqual({ $t: 'object', v: { $redacted: 1 } })
  })
  it('redaction : chemins, motifs, valeurs non textuelles, clé par défaut', () => {
    const secrets: string[] = []
    const out = serialize(
      { token: 7, apiKey: '', nested: { pin: 'x' } },
      {
        redactPatterns: [/^tok/],
        redactPaths: new Set(['arg0.nested.pin', 'arg0.apiKey']),
        secrets,
      },
      'arg0',
    ) as Record<string, Record<string, unknown>>
    expect(out['token']).toMatchObject({ $redacted: true, type: 'number' })
    expect(out['apiKey']).toMatchObject({ $redacted: true, type: 'string' })
    expect(out['nested']?.['pin']).toMatchObject({ $redacted: true, type: 'string' })
    expect(secrets).toEqual(['x'])
    expect(serialize(null, { redactPaths: new Set(['arg0']) }, 'arg0')).toMatchObject({
      $redacted: true,
      type: 'null',
    })
  })
  it('reconstruction de chaque forme étiquetée ; formes non reconstructibles refusées', () => {
    const back = (j: unknown) => deserialize(j as never)
    expect(back({ $t: 'number', v: 'Infinity' })).toBe(Infinity)
    expect(back({ $t: 'bigint', v: '5' })).toBe(5n)
    expect(String(back({ $t: 'symbol', v: 's' }))).toBe('Symbol(s)')
    expect(back({ $t: 'date', v: '1970-01-01T00:00:00.000Z' })).toEqual(new Date(0))
    expect(Number.isNaN((back({ $t: 'date', v: null }) as Date).getTime())).toBe(true)
    expect(back({ $t: 'regexp', source: 'a', flags: 'g' })).toEqual(/a/g)
    expect(back({ $t: 'map', entries: [[]] })).toEqual(new Map([[null, null]]))
    expect((back({ $t: 'bytes', base64: 'aGk=' }) as Buffer).toString()).toBe('hi')
    const e = back({ $t: 'error', name: 'TypeError', message: 'm' }) as Error
    expect([e.name, e.message]).toEqual(['TypeError', 'm'])
    expect(back({ $t: 'object', v: { $t: 1 } })).toEqual({ $t: 1 })
    for (const t of ['string', 'opaque', 'circular', 'truncated', 'hole'])
      expect(() => back({ $t: t })).toThrow(/non reconstructible/)
    expect(() => back({ $t: 'array', items: [] })).toThrow(/tableau tronqué/)
  })
  it('typeOfSerialized : l’étiquette est le type', () => {
    expect(typeOfSerialized({ $t: 'object', v: {} } as never)).toBe('object')
    expect(typeOfSerialized({ $t: 'array' } as never)).toBe('array')
    expect(typeOfSerialized({ $t: 'bigint', v: '1' } as never)).toBe('bigint')
  })
})
