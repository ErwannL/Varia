import type { Json } from '@varia/probe-protocol'
import type { InputDescriptor } from '../catalog.js'

export interface MutationCandidate {
  strategy: string
  op: 'set' | 'delete'
  value: Json
}

/** Interface d'extension (CDC §13.1). */
export interface MutationStrategy {
  id: string
  supports(input: InputDescriptor): boolean
  generate(input: InputDescriptor, ctx: MutationContext): MutationCandidate[]
}

/** Limites dures (CDC §32-5) appliquées par toutes les stratégies. */
export interface MutationContext {
  stringLength: number
  arrayLength: number
  objectDepth: number
}

export const DEFAULT_CONTEXT: MutationContext = {
  stringLength: 10_000,
  arrayLength: 1_000,
  objectDepth: 20,
}

export const UNDEF: Json = { $t: 'undefined' }
export const num = (v: number): Json =>
  Number.isNaN(v)
    ? { $t: 'number', v: 'NaN' }
    : v === Infinity
      ? { $t: 'number', v: 'Infinity' }
      : v === -Infinity
        ? { $t: 'number', v: '-Infinity' }
        : Object.is(v, -0)
          ? { $t: 'number', v: '-0' }
          : v
export const set = (strategy: string, value: Json): MutationCandidate => ({
  strategy,
  op: 'set',
  value,
})
