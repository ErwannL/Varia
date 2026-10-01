import type { Json } from './events.js'
import type { InputDescriptor } from './catalog.js'

export interface MutationCandidate {
  strategy: string
  op: 'set' | 'delete'
  value: Json
}

export interface MutationStrategy {
  id: string
  supports(input: InputDescriptor): boolean
  generate(input: InputDescriptor): MutationCandidate[]
}

const UNDEF: Json = { $t: 'undefined' }
const set = (strategy: string, value: Json): MutationCandidate => ({ strategy, op: 'set', value })

/** Sous-ensemble J0 des stratégies du §13.2 (type, null, undefined, empty, boundary). */
export const STRATEGIES: MutationStrategy[] = [
  {
    id: 'type',
    supports: (i) => ['string', 'number', 'boolean', 'object', 'array'].includes(i.type),
    generate(i) {
      switch (i.type) {
        case 'string':
          return [set('type', 123), set('type', {}), set('type', [])]
        case 'number':
          return [set('type', String(i.original)), set('type', {}), set('type', [])]
        case 'boolean':
          return [set('type', 'true'), set('type', 1)]
        case 'object':
          return [set('type', []), set('type', 'abc'), set('type', 123)]
        default:
          return [set('type', {}), set('type', 'abc')]
      }
    },
  },
  { id: 'null', supports: (i) => i.type !== 'null', generate: () => [set('null', null)] },
  {
    id: 'undefined',
    supports: (i) => i.type !== 'undefined',
    generate: (i) => [
      set('undefined', UNDEF),
      ...(i.inObject ? [{ strategy: 'undefined', op: 'delete' as const, value: null }] : []),
    ],
  },
  {
    id: 'empty',
    supports: () => true,
    generate: () => [set('empty', ''), set('empty', ' '), set('empty', []), set('empty', {})],
  },
  {
    id: 'boundary',
    supports: (i) => i.type === 'number' || i.type === 'string',
    generate(i) {
      if (i.type === 'string') return [set('boundary', ''), set('boundary', 'a')]
      const n = typeof i.original === 'number' ? i.original : 0
      return [-1, 0, 1, n - 1, n + 1, Number.MAX_SAFE_INTEGER].map((v) => set('boundary', v))
    },
  },
]
