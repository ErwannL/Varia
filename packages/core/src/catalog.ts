import type { Json } from '@varia/probe-protocol'
import { typeOfSerialized } from '@varia/probe-runtime'
import { detectFormat, type FormatName, type Hint } from './hints.js'
import type { ObservedCall } from './observe.js'

export interface Bounds {
  min: number
  max: number
  provenance: 'declared' | 'observed'
}

export interface InputDescriptor {
  callSiteId: string
  testId: string
  module: string
  export: string
  depth: number
  sequence: number
  argsFingerprint: string
  /** Segments : premier = indice d'argument ("0"), puis clés / indices. */
  path: string[]
  pathStr: string
  type: string
  original: Json
  /** Le parent est un objet : la suppression de la propriété a un sens. */
  inObject: boolean
  mutable: boolean
  reason?: 'OPAQUE' | 'REDACTED' | 'SKIPPED_BY_CONFIG' | 'TRUNCATED'
  format?: FormatName
  /** Bornes numériques (valeur) ou de longueur (chaîne/tableau), avec leur provenance (§12.3). */
  bounds?: Bounds
  hint?: Hint
}

const MAX_ARRAY_ITEMS = 5

export function pathString(path: string[]): string {
  return path
    .map((seg, i) => (i === 0 ? `arg${seg}` : /^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`))
    .join('')
}

function nonMutable(json: Json): InputDescriptor['reason'] | undefined {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return undefined
  if ('$redacted' in json) return 'REDACTED'
  const t = json['$t']
  if (t === 'opaque' || t === 'circular' || t === 'symbol') return 'OPAQUE'
  if (t === 'truncated' || t === 'string' || t === 'array') return 'TRUNCATED'
  return undefined
}

export function fieldsOf(json: Json): Record<string, Json> | null {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
  if ('$redacted' in json) return null
  if (json['$t'] === undefined) return json
  const v = json['v']
  if (
    json['$t'] === 'object' &&
    v !== null &&
    v !== undefined &&
    typeof v === 'object' &&
    !Array.isArray(v)
  )
    return v
  return null
}

const measure = (json: Json): number | null =>
  typeof json === 'number'
    ? json
    : typeof json === 'string'
      ? json.length
      : Array.isArray(json)
        ? json.length
        : null

export interface CatalogOptions {
  skip?: string[]
  hints?: Hint[]
}

/** Catalogue d'inputs (CDC §12) des appels directs (depth 0) observés, avec bornes et formats. */
export function buildCatalog(calls: ObservedCall[], o: CatalogOptions = {}): InputDescriptor[] {
  const out: InputDescriptor[] = []
  for (const call of calls) {
    if (call.depth !== 0 || call.args === null) continue
    const visit = (json: Json, path: string[], inObject: boolean) => {
      const pathStr = pathString(path)
      const key = `${call.export}#${pathStr}`
      const reason = (o.skip ?? []).includes(key) ? 'SKIPPED_BY_CONFIG' : nonMutable(json)
      const hint = o.hints?.find((h) => h.path === key)
      const format = typeof json === 'string' ? detectFormat(json) : undefined
      out.push({
        callSiteId: call.callSiteId,
        testId: call.testId,
        module: call.module,
        export: call.export,
        depth: call.depth,
        sequence: call.sequence,
        argsFingerprint: call.argsFingerprint,
        path,
        pathStr,
        type: typeOfSerialized(json),
        original: json,
        inObject,
        mutable: reason === undefined,
        ...(reason !== undefined ? { reason } : {}),
        ...(format !== undefined ? { format } : {}),
        ...(hint !== undefined ? { hint } : {}),
      })
      if (reason !== undefined) return
      const fields = fieldsOf(json)
      if (fields) for (const [k, v] of Object.entries(fields)) visit(v, [...path, k], true)
      else if (Array.isArray(json))
        json.slice(0, MAX_ARRAY_ITEMS).forEach((v, i) => visit(v, [...path, String(i)], false))
    }
    call.args.forEach((arg, i) => visit(arg, [String(i)], false))
  }
  attachBounds(out)
  return out
}

/** Bornes : déclarées par un hint (prioritaires), sinon observées sur l'ensemble des appels (§12.3). */
function attachBounds(inputs: InputDescriptor[]): void {
  const observed = new Map<string, { min: number; max: number }>()
  for (const i of inputs) {
    const m = measure(i.original)
    if (m === null || !Number.isFinite(m)) continue
    const key = `${i.module}#${i.export}#${i.pathStr}#${i.type}`
    const b = observed.get(key)
    observed.set(key, b ? { min: Math.min(b.min, m), max: Math.max(b.max, m) } : { min: m, max: m })
  }
  for (const i of inputs) {
    const declared = i.type === 'number' ? i.hint?.range : i.hint?.length
    if (declared) {
      i.bounds = { min: declared[0], max: declared[1], provenance: 'declared' }
      continue
    }
    const b = observed.get(`${i.module}#${i.export}#${i.pathStr}#${i.type}`)
    if (b) i.bounds = { ...b, provenance: 'observed' }
  }
}
