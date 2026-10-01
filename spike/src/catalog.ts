import type { Json } from './events.js'
import type { ObservedCall } from './observe.js'
import { typeOfSerialized } from './serialize.js'

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

function fieldsOf(json: Json): Record<string, Json> | null {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
  if ('$redacted' in json) return null
  if (json['$t'] === undefined) return json
  if (
    json['$t'] === 'object' &&
    json['v'] !== null &&
    typeof json['v'] === 'object' &&
    !Array.isArray(json['v'])
  ) {
    return json['v']
  }
  return null
}

/** Catalogue d'inputs (CDC §12) des appels directs (depth 0) observés. */
export function buildCatalog(calls: ObservedCall[], skip: string[] = []): InputDescriptor[] {
  const out: InputDescriptor[] = []
  for (const call of calls) {
    if (call.depth !== 0 || call.args === null) continue
    const visit = (json: Json, path: string[], inObject: boolean) => {
      const pathStr = pathString(path)
      const reason = skip.includes(`${call.export}#${pathStr}`)
        ? 'SKIPPED_BY_CONFIG'
        : nonMutable(json)
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
      })
      if (reason !== undefined) return
      const fields = fieldsOf(json)
      if (fields) for (const [k, v] of Object.entries(fields)) visit(v, [...path, k], true)
      else if (Array.isArray(json))
        json.slice(0, MAX_ARRAY_ITEMS).forEach((v, i) => visit(v, [...path, String(i)], false))
    }
    call.args.forEach((arg, i) => visit(arg, [String(i)], false))
  }
  return out
}
