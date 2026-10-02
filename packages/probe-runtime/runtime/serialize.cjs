// @ts-check
'use strict'
// Sérialisation étiquetée (CDC §10.7), redaction (§10.6), empreintes SHA-256 et identité de test.
// Partagé entre la sonde (dans le contexte vm de Jest) et l'orchestrateur : aucune dépendance au
// royaume (pas d'instanceof : on lit Object.prototype.toString).

const nodeCrypto = require('crypto')

/** @typedef {import('../../probe-protocol/src/index.js').Json} JsonValue */
/**
 * @typedef {object} SerializeOptions
 * @property {Set<string>} [redactFields] noms de champs (en minuscules) à masquer
 * @property {RegExp[]} [redactPatterns] motifs (sur le nom de champ) à masquer
 * @property {Set<string>} [redactPaths] chemins complets à masquer (ex. "arg0.password")
 * @property {string} [hmacKey] clé HMAC des empreintes de valeurs masquées
 * @property {number} [maxDepth]
 * @property {number} [maxString]
 * @property {number} [maxItems]
 * @property {string[]} [secrets] collecteur des chaînes brutes masquées (pour filtrer messages et piles)
 */

const toTag = (/** @type {unknown} */ v) => Object.prototype.toString.call(v).slice(8, -1)

/** Type runtime d'une valeur (CDC §12.2). @param {unknown} v */
function typeOf(v) {
  if (v === null) return 'null'
  const t = typeof v
  if (t !== 'object') return t
  if (Array.isArray(v)) return 'array'
  const tag = toTag(v)
  if (tag === 'Date') return 'date'
  if (tag === 'RegExp') return 'regexp'
  if (tag === 'Error') return 'error'
  if (tag === 'Map') return 'map'
  if (tag === 'Set') return 'set'
  if (ArrayBuffer.isView(v)) return 'bytes'
  return 'object'
}

/** JSON à clés triées, indentation fixe : base des empreintes et du plan « identique octet à octet ». */
function stableStringify(/** @type {unknown} */ value, indent = 0) {
  return JSON.stringify(sortKeys(value), null, indent)
}

/**
 * Pose une clé PROPRE (jamais une écriture de prototype) : `__proto__` est une donnée comme une autre
 * (A-01 : `out["__proto__"] = x` changerait le prototype et ferait disparaître la clé).
 * @param {Record<string, unknown>} obj @param {string} key @param {unknown} value
 */
function setOwn(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true })
}

/** @param {unknown} v @returns {unknown} */
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v !== null && typeof v === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const k of Object.keys(v).sort())
      setOwn(out, k, sortKeys(/** @type {Record<string, unknown>} */ (v)[k]))
    return out
  }
  return v
}

const sha256 = (/** @type {string} */ s) => nodeCrypto.createHash('sha256').update(s).digest('hex')
const hmac = (/** @type {string} */ key, /** @type {string} */ s) =>
  nodeCrypto.createHmac('sha256', key).update(s).digest('hex')

/** Identité stable d'un test (CDC §10.9) : fichier relatif, nom complet résolu, rang des homonymes. */
function testIdOf(
  /** @type {string} */ file,
  /** @type {string} */ name,
  /** @type {number} */ dup,
) {
  return 't_' + sha256([file, name, String(dup)].join('\u0000')).slice(0, 16)
}

/** Identité d'un call site (CDC §10.4). */
function callSiteIdOf(
  /** @type {string} */ testId,
  /** @type {string} */ module,
  /** @type {string} */ exportName,
  /** @type {number} */ depth,
  /** @type {number} */ sequence,
) {
  return (
    'c_' +
    sha256([testId, module, exportName, String(depth), String(sequence)].join('\u0000')).slice(
      0,
      16,
    )
  )
}

const OPAQUE_HINTS = ['pipe', 'emit']

/**
 * @param {unknown} value
 * @param {SerializeOptions} opts
 * @param {string} path
 * @param {number} depth
 * @param {WeakSet<object>} seen
 * @returns {JsonValue}
 */
function ser(value, opts, path, depth, seen) {
  const maxString = opts.maxString ?? 4096
  switch (typeof value) {
    case 'string':
      return value.length > maxString
        ? { $t: 'string', truncated: true, length: value.length, sha256: sha256(value) }
        : value
    case 'number':
      if (Number.isNaN(value)) return { $t: 'number', v: 'NaN' }
      if (value === Infinity) return { $t: 'number', v: 'Infinity' }
      if (value === -Infinity) return { $t: 'number', v: '-Infinity' }
      if (Object.is(value, -0)) return { $t: 'number', v: '-0' }
      return value
    case 'boolean':
      return value
    case 'undefined':
      return { $t: 'undefined' }
    case 'bigint':
      return { $t: 'bigint', v: value.toString() }
    case 'symbol':
      return { $t: 'symbol', v: value.description ?? '' }
    case 'function':
      return { $t: 'opaque', kind: 'function', name: value.name }
  }
  if (value === null) return null
  const obj = /** @type {object} */ (value)
  if (seen.has(obj)) return { $t: 'circular' }
  const type = typeOf(obj)
  if (depth >= (opts.maxDepth ?? 8)) return { $t: 'truncated', type }
  seen.add(obj)
  try {
    const maxItems = opts.maxItems ?? 200
    if (type === 'date') {
      const t = /** @type {Date} */ (obj).getTime()
      return { $t: 'date', v: Number.isNaN(t) ? null : new Date(t).toISOString() }
    }
    if (type === 'regexp') {
      const r = /** @type {RegExp} */ (obj)
      return { $t: 'regexp', source: r.source, flags: r.flags }
    }
    if (type === 'error') {
      const e = /** @type {Error} */ (obj)
      return { $t: 'error', name: String(e.name), message: String(e.message) }
    }
    if (type === 'map') {
      const entries = [.../** @type {Map<unknown, unknown>} */ (obj).entries()].slice(0, maxItems)
      return {
        $t: 'map',
        entries: entries.map(([k, v], i) => [
          ser(k, opts, `${path}.<key${i}>`, depth + 1, seen),
          ser(v, opts, `${path}.<value${i}>`, depth + 1, seen),
        ]),
      }
    }
    if (type === 'set') {
      const values = [.../** @type {Set<unknown>} */ (obj).values()].slice(0, maxItems)
      return {
        $t: 'set',
        values: values.map((v, i) => ser(v, opts, `${path}[${i}]`, depth + 1, seen)),
      }
    }
    if (type === 'bytes') {
      const view = /** @type {ArrayBufferView} */ (obj)
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
      return {
        $t: 'bytes',
        kind: obj.constructor?.name ?? 'Uint8Array',
        base64: Buffer.from(bytes).toString('base64'),
      }
    }
    if (Array.isArray(obj)) {
      /** @type {JsonValue[]} */
      const out = []
      const n = Math.min(obj.length, maxItems)
      for (let i = 0; i < n; i++) {
        out.push(i in obj ? ser(obj[i], opts, `${path}[${i}]`, depth + 1, seen) : { $t: 'hole' })
      }
      if (obj.length > n) return { $t: 'array', truncated: true, length: obj.length, items: out }
      return out
    }
    const record = /** @type {Record<string, unknown>} */ (obj)
    const proto = Object.getPrototypeOf(obj)
    const plain =
      proto === null ||
      proto === Object.prototype ||
      (toTag(proto) === 'Object' && proto.constructor?.name === 'Object')
    if (!plain && OPAQUE_HINTS.every((m) => typeof record[m] === 'function')) {
      return { $t: 'opaque', kind: proto.constructor?.name ?? 'object' }
    }
    if (toTag(obj) === 'Promise') return { $t: 'opaque', kind: 'Promise' }
    /** @type {Record<string, JsonValue>} */
    const fields = {}
    for (const key of Object.keys(record).slice(0, maxItems)) {
      const childPath = `${path}.${key}`
      const raw = record[key]
      if (
        opts.redactFields?.has(key.toLowerCase()) ||
        opts.redactPaths?.has(childPath) ||
        opts.redactPatterns?.some((re) => re.test(key))
      ) {
        setOwn(fields, key, redacted(raw, opts))
      } else {
        setOwn(fields, key, ser(raw, opts, childPath, depth + 1, seen))
      }
    }
    const escaped = '$t' in fields || '$redacted' in fields
    if (!plain) return { $t: 'object', ctor: String(proto.constructor?.name ?? ''), v: fields }
    return escaped ? { $t: 'object', v: fields } : fields
  } finally {
    seen.delete(obj)
  }
}

/** @param {unknown} raw @param {SerializeOptions} opts @returns {JsonValue} */
function redacted(raw, opts) {
  if (typeof raw === 'string' && raw.length > 0) opts.secrets?.push(raw)
  const inner = ser(
    raw,
    { ...opts, redactFields: new Set(), redactPaths: new Set() },
    '',
    0,
    new WeakSet(),
  )
  return {
    $redacted: true,
    fingerprint: hmac(opts.hmacKey ?? 'varia', stableStringify(inner)),
    type: typeOf(raw),
  }
}

/** Sérialise une valeur racine (chemin de base `root`, ex. "arg0"). */
function serialize(
  /** @type {unknown} */ value,
  /** @type {SerializeOptions} */ opts = {},
  root = '',
) {
  if (opts.redactPaths?.has(root)) return redacted(value, opts)
  return ser(value, opts, root, 0, new WeakSet())
}

/** Sérialise une liste d'arguments (chemins arg0, arg1…). */
function serializeArgs(/** @type {unknown[]} */ args, /** @type {SerializeOptions} */ opts = {}) {
  return args.map((a, i) => serialize(a, opts, `arg${i}`))
}

/** Reconstruit une valeur (dans le royaume courant) à partir de sa forme étiquetée. @returns {unknown} */
function deserialize(/** @type {JsonValue} */ json) {
  if (json === null || typeof json !== 'object') return json
  if (Array.isArray(json)) {
    const out = new Array(json.length)
    json.forEach((item, i) => {
      if (
        !(
          item !== null &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          item['$t'] === 'hole'
        )
      ) {
        out[i] = deserialize(item)
      }
    })
    return out
  }
  const t = json['$t']
  switch (t) {
    case 'undefined':
      return undefined
    case 'number':
      return json['v'] === '-0' ? -0 : Number(json['v'])
    case 'bigint':
      return BigInt(String(json['v']))
    case 'symbol':
      return Symbol(String(json['v']))
    case 'date':
      return new Date(json['v'] === null ? NaN : String(json['v']))
    case 'regexp':
      return new RegExp(String(json['source']), String(json['flags']))
    case 'map':
      return new Map(
        /** @type {JsonValue[][]} */ (json['entries']).map(([k, v]) => [
          deserialize(k ?? null),
          deserialize(v ?? null),
        ]),
      )
    case 'set':
      return new Set(/** @type {JsonValue[]} */ (json['values']).map(deserialize))
    case 'bytes':
      return Buffer.from(String(json['base64']), 'base64')
    case 'error': {
      const e = new Error(String(json['message']))
      e.name = String(json['name'])
      return e
    }
    case 'string':
    case 'opaque':
    case 'circular':
    case 'truncated':
    case 'hole':
      throw new Error(`valeur non reconstructible : ${String(t)}`)
    case 'object':
      return deserializeFields(/** @type {Record<string, JsonValue>} */ (json['v']))
    case 'array':
      throw new Error('tableau tronqué non reconstructible')
    default:
      return deserializeFields(json)
  }
}

/** @param {Record<string, JsonValue>} fields */
function deserializeFields(fields) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [k, v] of Object.entries(fields)) {
    setOwn(out, k, deserialize(v))
  }
  return out
}

/** Empreinte des arguments (forme déjà redigée). */
function fingerprint(/** @type {unknown} */ serialized) {
  return sha256(stableStringify(serialized))
}

/** Type runtime d'une forme sérialisée. @param {JsonValue} json */
function typeOfSerialized(json) {
  if (json === null) return 'null'
  if (Array.isArray(json)) return 'array'
  if (typeof json !== 'object') return typeof json
  if ('$redacted' in json) return String(json['type'])
  const t = json['$t']
  // Forme étiquetée : son étiquette EST le type runtime (number, bigint, object, array, date…).
  return t === undefined ? 'object' : String(t)
}

module.exports = {
  callSiteIdOf,
  setOwn,
  deserialize,
  fingerprint,
  hmac,
  serialize,
  serializeArgs,
  sha256,
  stableStringify,
  testIdOf,
  typeOf,
  typeOfSerialized,
}
