import type { Json } from '@varia/probe-protocol'
import { fieldsOf, type InputDescriptor } from '../catalog.js'
import type { FormatName } from '../hints.js'
import {
  num,
  set,
  UNDEF,
  type BoundsProvenance,
  type MutationCandidate,
  type MutationContext,
  type MutationStrategy,
} from './types.js'

export * from './types.js'

const firstOf = (json: Json): Json =>
  Array.isArray(json) && json.length > 0 ? (json[0] ?? null) : 1

/** `type` : type d'une famille voisine (CDC §13.2-13.3). */
const type: MutationStrategy = {
  id: 'type',
  supports: (i) =>
    [
      'string',
      'number',
      'boolean',
      'object',
      'array',
      'date',
      'bigint',
      'map',
      'set',
      'bytes',
    ].includes(i.type),
  generate(i) {
    const s = (v: Json) => set('type', v)
    switch (i.type) {
      case 'string':
        // Autres types, puis chaînes qui se font passer pour un nombre, null ou un booléen (§13.3).
        return [s(123), s(true), s({}), s([]), s('123'), s('null'), s('true')]
      case 'number':
        return [s(String(typeof i.original === 'number' ? i.original : 0)), s({}), s([]), s(true)]
      case 'boolean':
        return [s(0), s(1), s('true'), s('false'), s({}), s([])]
      case 'object':
        return [s([]), s('abc'), s(123)]
      case 'array':
        return [s({}), s('abc'), s(0)]
      case 'date':
        return [s('2020-01-01'), s(0)]
      case 'map':
        return [s({}), s([])]
      case 'set':
        return [s([]), s({})]
      case 'bytes':
        return [s('abc'), s([1, 2, 3])]
      default:
        return [s(1), s('1')]
    }
  },
}

const nul: MutationStrategy = {
  id: 'null',
  supports: (i) => i.type !== 'null',
  generate: () => [set('null', null)],
}

const undef: MutationStrategy = {
  id: 'undefined',
  supports: (i) => i.type !== 'undefined',
  generate: (i) => [
    set('undefined', UNDEF),
    ...(i.inObject ? [{ strategy: 'undefined', op: 'delete' as const, value: null }] : []),
  ],
}

/** Vides dédiés aux collections étiquetées (catalogues Map, Set, Buffer, §13.3). */
const TAGGED_EMPTY: Record<string, Json> = {
  map: { $t: 'map', entries: [] },
  set: { $t: 'set', values: [] },
  bytes: { $t: 'bytes', kind: 'Buffer', base64: '' },
}

const empty: MutationStrategy = {
  id: 'empty',
  supports: () => true,
  generate: (i) => [
    set('empty', ''),
    set('empty', ' '),
    set('empty', []),
    set('empty', {}),
    ...(TAGGED_EMPTY[i.type] !== undefined ? [set('empty', TAGGED_EMPTY[i.type] as Json)] : []),
  ],
}

/** `boundary` : -1/0/1, bornes déclarées ou observées ±1, extrêmes numériques, longueurs limites. */
const boundary: MutationStrategy = {
  id: 'boundary',
  supports: (i) => ['number', 'string', 'array', 'date', 'bigint'].includes(i.type),
  generate(i, ctx) {
    // Bornes déclarées / observées D'ABORD : une valeur qui coïncide avec une borne universelle garde
    // la provenance la plus informative (la déduplication conserve la première).
    const from = i.bounds?.provenance
    const b = (v: Json, provenance: BoundsProvenance = 'universal'): MutationCandidate => ({
      ...set('boundary', v),
      provenance,
    })
    const out: MutationCandidate[] = []
    if (i.type === 'number') {
      if (i.bounds && from)
        out.push(
          b(num(i.bounds.min - 1), from),
          b(num(i.bounds.max + 1), from),
          b(num(i.bounds.min), from),
          b(num(i.bounds.max), from),
        )
      for (const v of [
        -1,
        0,
        1,
        -0,
        0.5,
        NaN,
        Infinity,
        -Infinity,
        Number.MAX_VALUE,
        Number.MIN_VALUE,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER + 1,
      ])
        out.push(b(num(v)))
    } else if (i.type === 'string') {
      if (i.bounds && from) {
        for (const n of [i.bounds.min - 1, i.bounds.max + 1])
          if (n >= 0 && n <= ctx.stringLength) out.push(b('a'.repeat(n), from))
      }
      out.push(b(''), b('a'))
    } else if (i.type === 'array') {
      if (i.bounds && from && i.bounds.max + 1 <= ctx.arrayLength)
        out.push(b(new Array<Json>(i.bounds.max + 1).fill(firstOf(i.original)), from))
      out.push(b([]), b([firstOf(i.original)]))
    } else if (i.type === 'date') {
      out.push(
        b({ $t: 'date', v: null }),
        b({ $t: 'date', v: '+275760-09-13T00:00:00.000Z' }),
        b({ $t: 'date', v: '1970-01-01T00:00:00.000Z' }),
      )
    } else {
      out.push(
        b({ $t: 'bigint', v: '0' }),
        b({ $t: 'bigint', v: '-1' }),
        b({ $t: 'bigint', v: (2n ** 64n).toString() }),
      )
    }
    return out
  },
}

/** `size` : chaîne, tableau et imbrication plafonnés par les limites dures. */
const size: MutationStrategy = {
  id: 'size',
  supports: (i) => ['string', 'array', 'object'].includes(i.type),
  generate(i, ctx) {
    if (i.type === 'string') return [set('size', 'x'.repeat(ctx.stringLength))]
    if (i.type === 'array')
      return [set('size', new Array<Json>(ctx.arrayLength).fill(firstOf(i.original)))]
    let deep: Json = { leaf: 1 }
    for (let d = 0; d < ctx.objectDepth; d++) deep = { nested: deep }
    return [set('size', deep)]
  },
}

/** `structure` : champ ajouté / mal typé, clés exotiques (sur copies), tableau imbriqué ou creux. */
const structure: MutationStrategy = {
  id: 'structure',
  supports: (i) => i.type === 'object' || i.type === 'array',
  generate(i) {
    if (i.type === 'array') {
      const first = firstOf(i.original)
      return [
        set('structure', [[first]]),
        set('structure', [first, { $t: 'hole' }, first]),
        set('structure', [first, null, {}]),
        // Éléments d'un type inattendu (§13.3) : [null], [""], [1], [1, null, {}].
        set('structure', [null]),
        set('structure', ['']),
        set('structure', [1]),
        set('structure', [1, null, {}]),
      ]
    }
    const fields = fieldsOf(i.original) ?? {}
    const keys = Object.keys(fields)
    const out: MutationCandidate[] = [
      set('structure', { ...fields, __varia_extra__: 'unexpected' }),
      set('structure', { $t: 'object', v: { ...fields, ['__proto__']: { polluted: true } } }),
      set('structure', { ...fields, constructor: 'not-a-function' }),
    ]
    const first = keys[0]
    if (first !== undefined)
      out.push(set('structure', { ...fields, [first]: [fields[first] ?? null] }))
    return out
  },
}

const INVALID_FORMATS: Record<FormatName, string[]> = {
  email: ['user@', '@example.com', 'user@@example.com', 'user example.com', 'user@example'],
  uuid: [
    '00000000-0000-0000-0000-00000000000',
    'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
    '00000000000000000000000000000000',
  ],
  url: ['http://', 'not a url', 'http//example.com', '://example.com'],
  'iso-date': ['2024-13-45', '2024-02-30T25:61:00Z', 'not-a-date', '0000-00-00'],
  ipv4: ['256.1.1.1', '1.2.3', '1.2.3.4.5', 'a.b.c.d'],
}

/** `format` : variantes invalides d'un format reconnu avec confiance (ou déclaré par un hint). */
const format: MutationStrategy = {
  id: 'format',
  supports: (i) => i.type === 'string' && (i.format !== undefined || i.hint?.format !== undefined),
  generate: (i) =>
    INVALID_FORMATS[(i.hint?.format ?? i.format) as FormatName].map((v) => set('format', v)),
}

/** `encoding` : accents, emoji, contrôle, RTL, combinaisons, surrogate isolé, CJK. */
const encoding: MutationStrategy = {
  id: 'encoding',
  supports: (i) => i.type === 'string',
  generate: () =>
    // « é » précomposé (U+00E9) puis décomposé (e + accent combinant U+0301) : deux chaînes distinctes.
    ['\u00e9', '💀', '漢字', 'abc\n', 'abc\u0000', '\u202eabc', 'e\u0301', '\uD800', '"\'<>&'].map(
      (v) => set('encoding', v),
    ),
}

export const STRATEGIES: MutationStrategy[] = [
  type,
  nul,
  undef,
  empty,
  boundary,
  size,
  structure,
  format,
  encoding,
]
export const STRATEGY_IDS = STRATEGIES.map((s) => s.id)

export function candidatesFor(
  input: InputDescriptor,
  strategies: string[],
  ctx: MutationContext,
): MutationCandidate[] {
  const out: MutationCandidate[] = []
  for (const s of STRATEGIES)
    if (strategies.includes(s.id) && s.supports(input)) out.push(...s.generate(input, ctx))
  return out
}
