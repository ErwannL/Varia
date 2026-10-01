import type { Json } from '@varia/probe-protocol'

export type FormatName = 'email' | 'uuid' | 'url' | 'iso-date' | 'ipv4'

export interface Hint {
  /** `export#chemin`, ex. `createUser#arg0.age`. */
  path: string
  range?: [number, number] | undefined
  format?: FormatName | undefined
  length?: [number, number] | undefined
}

export const FORMAT_PATTERNS: Record<FormatName, RegExp> = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  url: /^https?:\/\/[^\s/$.?#][^\s]*$/i,
  'iso-date': /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
  ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/,
}

/** Format reconnu « avec confiance » (CDC §13.2) : la chaîne entière correspond à un motif strict. */
export function detectFormat(value: string): FormatName | undefined {
  return (Object.keys(FORMAT_PATTERNS) as FormatName[]).find((f) => FORMAT_PATTERNS[f].test(value))
}

/**
 * La valeur mutée (forme sérialisée) viole-t-elle le contrat déclaré ? (CDC §18.4-1, `HINT_VIOLATION`)
 * Une valeur d'un autre type que celui du contrat le viole aussi.
 */
export function violatesHint(hint: Hint, value: Json, deleted: boolean): boolean {
  if (deleted) return true
  if (hint.range) {
    if (typeof value !== 'number') return true
    if (value < hint.range[0] || value > hint.range[1]) return true
  }
  if (hint.format) {
    if (typeof value !== 'string' || !FORMAT_PATTERNS[hint.format].test(value)) return true
  }
  if (hint.length) {
    const len =
      typeof value === 'string' ? value.length : Array.isArray(value) ? value.length : null
    if (len === null || len < hint.length[0] || len > hint.length[1]) return true
  }
  return false
}
