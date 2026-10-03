// Rejeu du jeu de conformité du protocole (P-02) par la sonde JavaScript : construit les entrées du
// vocabulaire neutre (packages/probe-protocol/conformance/README.md) avec les types natifs de JS, les
// passe à l'implémentation de la sonde (serialize.cjs, probe.cjs) et compare avec la sortie attendue.
import { createRequire } from 'node:module'

const req = createRequire(import.meta.url)
const S = req('../runtime/serialize.cjs') as typeof import('../runtime/serialize.cjs')
const P = (req('../runtime/probe.cjs') as typeof import('../runtime/probe.cjs')).internals

type J = null | boolean | number | string | J[] | { [k: string]: J }
type Obj = Record<string, unknown>

export interface Case {
  id: string
  op: string
  input: Record<string, J>
  expected: J
}
export interface CaseFile {
  description: string
  cases: Case[]
}

const isObj = (v: J | undefined): v is { [k: string]: J } =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v: J | undefined): string => {
  if (typeof v !== 'string') throw new Error(`chaîne attendue : ${JSON.stringify(v)}`)
  return v
}
const num = (v: J | undefined): number => {
  if (typeof v !== 'number') throw new Error(`nombre attendu : ${JSON.stringify(v)}`)
  return v
}
const arr = (v: J | undefined): J[] => {
  if (!Array.isArray(v)) throw new Error(`tableau attendu : ${JSON.stringify(v)}`)
  return v
}
const own = (o: Obj, k: string, v: unknown) =>
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true })

/** Classe nommée dynamiquement, héritant de `base`. */
function named(name: string, base: new (...a: never[]) => object): new (...a: never[]) => object {
  const C = class extends base {}
  Object.defineProperty(C, 'name', { value: name })
  return C
}

/** Construit une valeur JS native depuis le vocabulaire neutre. `parent` : conteneur englobant (`self`). */
export function build(v: J, parent: object | null = null): unknown {
  if (Array.isArray(v)) {
    const out: unknown[] = []
    for (const x of v) out.push(build(x, out))
    return out
  }
  if (!isObj(v)) return v
  if (!('$in' in v)) return fill({}, Object.entries(v))
  switch (v['$in']) {
    case 'object':
      return fill(
        {},
        arr(v['entries']).map((e) => [str(arr(e)[0]), arr(e)[1] ?? null]),
      )
    case 'instance': {
      const C = named(str(v['class']), Object)
      return fill(
        Object.create(C.prototype) as Obj,
        arr(v['entries']).map((e) => [str(arr(e)[0]), arr(e)[1] ?? null]),
      )
    }
    case 'undefined':
      return undefined
    case 'number':
      return str(v['v']) === '-0' ? -0 : Number(str(v['v']))
    case 'bigint':
      return BigInt(str(v['v']))
    case 'date':
      return new Date(str(v['v']))
    case 'map': {
      const m = new Map<unknown, unknown>()
      for (const e of arr(v['entries']))
        m.set(build(arr(e)[0] ?? null, m), build(arr(e)[1] ?? null, m))
      return m
    }
    case 'set': {
      const s = new Set<unknown>()
      for (const x of arr(v['values'])) s.add(build(x, s))
      return s
    }
    case 'bytes':
      return Uint8Array.from(Buffer.from(str(v['base64']), 'base64'))
    case 'error':
      return buildError(v)
    case 'function': {
      const name = str(v['name'])
      return { [name]: () => undefined }[name]
    }
    case 'string':
      return str(v['repeat']).repeat(num(v['times']))
    case 'array':
      return Array.from({ length: num(v['times']) }, () => build(v['repeat'] ?? null))
    case 'nest': {
      let out = build(v['leaf'] ?? null)
      for (let i = 0; i < num(v['depth']); i++) out = own({}, str(v['key']), out)
      return out
    }
    case 'self':
      return parent
    default:
      throw new Error(`entrée neutre inconnue : ${JSON.stringify(v['$in'])}`)
  }
}

function fill(o: Obj, entries: [string, J][]): Obj {
  for (const [k, x] of entries) own(o, k, build(x, o))
  return o
}

/** Erreur dont la hiérarchie de classes est `chain` (plus dérivée d'abord) au-dessus de `Error`. */
function buildError(v: { [k: string]: J }): Error {
  let C: new (...a: never[]) => object = Error
  for (const name of [...arr(v['chain'] ?? [])].reverse()) C = named(str(name), C)
  const e = new (C as unknown as new (m: string) => Error)(str(v['message']))
  if (v['name'] !== undefined) e.name = str(v['name'])
  if (v['code'] !== undefined) own(e as unknown as Obj, 'code', v['code'])
  if (v['status'] !== undefined) own(e as unknown as Obj, 'status', v['status'])
  return e
}

/** Options de sérialisation d'un appel : redaction compilée comme le fait la sonde (`VARIA_REDACT`). */
function callOptions(input: Record<string, J>, secrets: string[]) {
  const redact = (isObj(input['redact']) ? input['redact'] : {}) as Parameters<
    typeof S.compileRedaction
  >[0]
  return S.argsOptions(S.compileRedaction(redact), str(input['export'] ?? 'f'), secrets)
}

/** Exécute une opération du jeu de conformité avec l'implémentation de la sonde JS. */
export function run(c: Case): unknown {
  const i = c.input
  switch (c.op) {
    case 'serialize':
      return S.serialize(build(i['value'] ?? null))
    case 'serializeArgs': {
      const args = S.serializeArgs(
        arr(i['args']).map((a) => build(a)),
        callOptions(i, []),
      )
      return { args, argsFingerprint: S.fingerprint(args) }
    }
    case 'serializeError': {
      const secrets: string[] = []
      S.serializeArgs(
        arr(i['args'] ?? []).map((a) => build(a)),
        callOptions(i, secrets),
      )
      return P.serializeError(build(i['error'] ?? null), secrets)
    }
    case 'testId':
      return S.testIdOf(str(i['file']), str(i['name']), num(i['rank']))
    case 'callSiteId':
      return S.callSiteIdOf(
        str(i['testId']),
        str(i['module']),
        str(i['export']),
        num(i['depth']),
        num(i['sequence']),
      )
    case 'canonical': {
      const text = S.stableStringify(i['value'], num(i['indent'] ?? 0))
      return { text, sha256: S.sha256(text) }
    }
    default:
      throw new Error(`opération inconnue : ${c.op}`)
  }
}

/**
 * Compare une sortie à l'attendu : égalité JSON stricte (ordre des clés indifférent), sauf les
 * jokers `{"$match":"string"}` (toute chaîne) et `{"$prefix":[…]}` (tableau commençant par…).
 * Renvoie la liste des écarts (chemin : attendu ≠ obtenu).
 */
export function mismatches(actual: unknown, expected: J, path = '$'): string[] {
  if (isObj(expected) && '$match' in expected)
    return typeof actual === expected['$match']
      ? []
      : [`${path} : ${String(expected['$match'])} attendu`]
  if (isObj(expected) && '$prefix' in expected) {
    const prefix = arr(expected['$prefix'])
    if (!Array.isArray(actual) || actual.length < prefix.length)
      return [`${path} : préfixe ${JSON.stringify(prefix)} attendu`]
    return prefix.flatMap((x, k) => mismatches(actual[k], x, `${path}[${k}]`))
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length)
      return [`${path} : ${JSON.stringify(expected)} ≠ ${JSON.stringify(actual)}`]
    return expected.flatMap((x, k) => mismatches(actual[k], x, `${path}[${k}]`))
  }
  if (isObj(expected)) {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual))
      return [`${path} : objet attendu, ${JSON.stringify(actual)} obtenu`]
    const a = actual as Obj
    const keys = Object.keys(expected)
    const extra = Object.keys(a).filter((k) => !keys.includes(k))
    if (extra.length > 0) return [`${path} : clés en trop ${JSON.stringify(extra)}`]
    return keys.flatMap((k) =>
      mismatches(Object.getOwnPropertyDescriptor(a, k)?.value, expected[k] ?? null, `${path}.${k}`),
    )
  }
  return Object.is(actual, expected)
    ? []
    : [`${path} : ${JSON.stringify(expected)} ≠ ${JSON.stringify(actual)}`]
}
