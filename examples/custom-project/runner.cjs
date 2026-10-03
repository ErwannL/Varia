'use strict'
// Lanceur de tests FACTICE branché dans Varia en `test.framework: custom` (X-01). Il n'importe RIEN de
// Varia : il implémente lui-même le protocole de sonde (docs/probe-protocol.md, norme 1.2) et le
// contrat de l'adaptateur custom (docs/writing-an-adapter.md, « Adaptateur custom »). But : montrer
// qu'un lanceur externe suffit, sans modifier Varia.
//
// Lanceur : fichiers `tests/**/*.test.js` (CommonJS), globaux `describe`, `it`, `test`, `test.each`,
// `expect` (sous-ensemble), exécution séquentielle dans UN processus.
// Sonde : enveloppe les exports des modules ciblés au chargement (`Module._extensions['.js']`).

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const Module = require('node:module')
const assert = require('node:assert')
const { AsyncLocalStorage, createHook } = require('node:async_hooks')
const { performance } = require('node:perf_hooks')

const VERSION = '1.0.0'
const PROTOCOL_VERSION = 1
const PROTOCOL_MINOR = 2
const MAX_LOGGED_CALLS = 20
const WRAPPED = Symbol('runner.wrapped')
const CALL_TAG = Symbol('runner.call')

// ---------------------------------------------------------------- JSON canonique, identités (§8, §10)

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s, 'utf8').digest('hex')
const setOwn = (o, k, v) =>
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true })

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v !== null && typeof v === 'object') {
    const out = {}
    // Les clés « index » passent d'abord (ordre ECMAScript), les autres par unités UTF-16.
    for (const k of Object.keys(v).sort()) setOwn(out, k, sortKeys(v[k]))
    return out
  }
  return v
}
const canonical = (v, indent = 0) => JSON.stringify(sortKeys(v), null, indent)
const testIdOf = (file, name, rank) =>
  't_' + sha256([file, name, String(rank)].join('\u0000')).slice(0, 16)
const callSiteIdOf = (testId, mod, exp, depth, seq) =>
  'c_' + sha256([testId, mod, exp, String(depth), String(seq)].join('\u0000')).slice(0, 16)

// ---------------------------------------------------------------- valeurs étiquetées (§5, §7)

const tagOf = (v) => Object.prototype.toString.call(v).slice(8, -1)
function typeOf(v) {
  if (v === null) return 'null'
  if (typeof v !== 'object') return typeof v
  if (Array.isArray(v)) return 'array'
  const t = tagOf(v)
  if (t === 'Date') return 'date'
  if (t === 'RegExp') return 'regexp'
  if (t === 'Error') return 'error'
  if (t === 'Map') return 'map'
  if (t === 'Set') return 'set'
  if (ArrayBuffer.isView(v)) return 'bytes'
  return 'object'
}

function compileRedaction(r) {
  return {
    fields: new Set((r.fields || []).map((f) => String(f).toLowerCase())),
    patterns: (r.patterns || []).map((p) => new RegExp(p, 'i')),
    skipPaths: r.skipPaths || [],
    hmacKey: String(r.hmacKey === undefined ? 'varia' : r.hmacKey),
  }
}

/** Options d'un appel à `exp` : chemins `exp#argN…` masqués, chaînes masquées collectées. */
function callOptions(red, exp, secrets) {
  const paths = new Set(
    red.skipPaths.filter((p) => p.startsWith(exp + '#')).map((p) => p.slice(exp.length + 1)),
  )
  return { fields: red.fields, patterns: red.patterns, paths, hmacKey: red.hmacKey, secrets }
}

const masked = (key, p, o) =>
  o.fields.has(key.toLowerCase()) || o.paths.has(p) || o.patterns.some((re) => re.test(key))

function redacted(raw, o) {
  if (typeof raw === 'string' && raw.length > 0) o.secrets.push(raw)
  const inner = ser(raw, { ...o, fields: new Set(), paths: new Set() }, '', 0, new WeakSet())
  return { $redacted: true, fingerprint: hmac(o.hmacKey, canonical(inner)), type: typeOf(raw) }
}

function ser(v, o, p, depth, seen) {
  switch (typeof v) {
    case 'string':
      return v.length > 4096
        ? { $t: 'string', truncated: true, length: v.length, sha256: sha256(v) }
        : v
    case 'number':
      if (Number.isNaN(v)) return { $t: 'number', v: 'NaN' }
      if (v === Infinity) return { $t: 'number', v: 'Infinity' }
      if (v === -Infinity) return { $t: 'number', v: '-Infinity' }
      return Object.is(v, -0) ? { $t: 'number', v: '-0' } : v
    case 'boolean':
      return v
    case 'undefined':
      return { $t: 'undefined' }
    case 'bigint':
      return { $t: 'bigint', v: v.toString() }
    case 'symbol':
      return { $t: 'symbol', v: v.description || '' }
    case 'function':
      return { $t: 'opaque', kind: 'function', name: v.name }
  }
  if (v === null) return null
  if (seen.has(v)) return { $t: 'circular' }
  const type = typeOf(v)
  if (depth >= 8) return { $t: 'truncated', type }
  seen.add(v)
  try {
    if (type === 'date') {
      const t = v.getTime()
      return { $t: 'date', v: Number.isNaN(t) ? null : new Date(t).toISOString() }
    }
    if (type === 'regexp') return { $t: 'regexp', source: v.source, flags: v.flags }
    if (type === 'error') return { $t: 'error', name: String(v.name), message: String(v.message) }
    if (type === 'map')
      return {
        $t: 'map',
        entries: [...v.entries()]
          .slice(0, 200)
          .map(([k, x], i) => [
            ser(k, o, `${p}.<key${i}>`, depth + 1, seen),
            typeof k === 'string' && masked(k, `${p}.${k}`, o)
              ? redacted(x, o)
              : ser(x, o, `${p}.<value${i}>`, depth + 1, seen),
          ]),
      }
    if (type === 'set')
      return {
        $t: 'set',
        values: [...v.values()]
          .slice(0, 200)
          .map((x, i) => ser(x, o, `${p}[${i}]`, depth + 1, seen)),
      }
    if (type === 'bytes')
      return {
        $t: 'bytes',
        kind: (v.constructor && v.constructor.name) || 'Uint8Array',
        base64: Buffer.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)).toString(
          'base64',
        ),
      }
    if (Array.isArray(v)) {
      const out = []
      const n = Math.min(v.length, 200)
      for (let i = 0; i < n; i++)
        out.push(i in v ? ser(v[i], o, `${p}[${i}]`, depth + 1, seen) : { $t: 'hole' })
      return v.length > n ? { $t: 'array', truncated: true, length: v.length, items: out } : out
    }
    const proto = Object.getPrototypeOf(v)
    const plain =
      proto === null ||
      proto === Object.prototype ||
      (tagOf(proto) === 'Object' && proto.constructor && proto.constructor.name === 'Object')
    if (!plain && typeof v.pipe === 'function' && typeof v.emit === 'function')
      return { $t: 'opaque', kind: (proto.constructor && proto.constructor.name) || 'object' }
    if (tagOf(v) === 'Promise') return { $t: 'opaque', kind: 'Promise' }
    const fields = {}
    for (const k of Object.keys(v).slice(0, 200)) {
      const cp = `${p}.${k}`
      setOwn(fields, k, masked(k, cp, o) ? redacted(v[k], o) : ser(v[k], o, cp, depth + 1, seen))
    }
    if (!plain)
      return {
        $t: 'object',
        ctor: String((proto.constructor && proto.constructor.name) || ''),
        v: fields,
      }
    return '$t' in fields || '$redacted' in fields ? { $t: 'object', v: fields } : fields
  } finally {
    seen.delete(v)
  }
}

const serialize = (v, o, root) =>
  o.paths.has(root) ? redacted(v, o) : ser(v, o, root, 0, new WeakSet())
const serializeArgs = (args, o) => args.map((a, i) => serialize(a, o, `arg${i}`))
const fingerprint = (serialized) => sha256(canonical(serialized))

// ---------------------------------------------------------------- erreurs (§6)

function safeGet(o, k) {
  try {
    return o[k]
  } catch {
    return undefined
  }
}
function str(v) {
  try {
    return String(v)
  } catch {
    return ''
  }
}

function serializeError(e, secrets) {
  const scrub = (s) => secrets.reduce((acc, x) => acc.split(x).join('[REDACTED]'), s)
  if (e === null || typeof e !== 'object')
    return { name: typeof e, message: scrub(str(e)), stack: '', constructorChain: [] }
  const chain = []
  try {
    for (
      let p = Object.getPrototypeOf(e);
      p !== null && chain.length < 10;
      p = Object.getPrototypeOf(p)
    ) {
      const n = safeGet(safeGet(p, 'constructor'), 'name')
      if (typeof n === 'string' && n !== 'Object') chain.push(n)
    }
  } catch {
    // Proxy hostile : chaîne partielle.
  }
  const raw = safeGet(e, 'stack')
  const frames = (typeof raw === 'string' ? raw : '')
    .split('\n')
    .slice(1)
    .filter((l) => !l.includes(__filename) && !l.includes('node:internal'))
    .slice(0, 15)
  const code = safeGet(e, 'code')
  let status = NaN
  try {
    status = Number(safeGet(e, 'status'))
  } catch {
    status = NaN
  }
  return {
    name: scrub(str(safeGet(e, 'name') ?? '')),
    message: scrub(str(safeGet(e, 'message') ?? '')),
    ...(code !== undefined ? { code: str(code) } : {}),
    ...(Number.isFinite(status) ? { status } : {}),
    stack: scrub(frames.join('\n')),
    constructorChain: chain,
  }
}

// ---------------------------------------------------------------- mutation (§9)

function deserialize(j) {
  if (j === null || typeof j !== 'object') return j
  if (Array.isArray(j)) {
    const out = new Array(j.length)
    j.forEach((x, i) => {
      if (!(x !== null && typeof x === 'object' && x.$t === 'hole')) out[i] = deserialize(x)
    })
    return out
  }
  switch (j.$t) {
    case 'undefined':
      return undefined
    case 'number':
      return j.v === '-0' ? -0 : Number(j.v)
    case 'bigint':
      return BigInt(j.v)
    case 'symbol':
      return Symbol(j.v)
    case 'date':
      return new Date(j.v === null ? NaN : j.v)
    case 'regexp':
      return new RegExp(j.source, j.flags)
    case 'map':
      return new Map(j.entries.map(([k, v]) => [deserialize(k), deserialize(v)]))
    case 'set':
      return new Set(j.values.map(deserialize))
    case 'bytes':
      return Buffer.from(j.base64, 'base64')
    case 'error': {
      const e = new Error(j.message)
      e.name = j.name
      return e
    }
    case 'object':
      return fields(j.v)
    case undefined:
      return fields(j)
    default:
      throw new Error(`valeur non reconstructible : ${String(j.$t)}`)
  }
}
function fields(f) {
  const out = {}
  for (const [k, v] of Object.entries(f)) setOwn(out, k, deserialize(v))
  return out
}

function deepClone(v, seen = new Map()) {
  if (v === null || typeof v !== 'object') return v
  if (seen.has(v)) return seen.get(v)
  const t = typeOf(v)
  if (t === 'date') return new Date(v.getTime())
  if (t === 'regexp') return new RegExp(v)
  if (t === 'bytes') return Buffer.from(v)
  if (t === 'map') {
    const m = new Map()
    seen.set(v, m)
    for (const [k, x] of v) m.set(k, deepClone(x, seen))
    return m
  }
  if (t === 'set') {
    const s = new Set()
    seen.set(v, s)
    for (const x of v) s.add(deepClone(x, seen))
    return s
  }
  const out = Array.isArray(v) ? new Array(v.length) : Object.create(Object.getPrototypeOf(v))
  seen.set(v, out)
  for (const k of Reflect.ownKeys(v)) {
    const d = Object.getOwnPropertyDescriptor(v, k)
    if ('value' in d) d.value = deepClone(d.value, seen)
    Object.defineProperty(out, k, d)
  }
  return out
}

/** Copie profonde des arguments, UN chemin remplacé ; `null` si le chemin n'existe pas. */
function applyMutation(args, m) {
  const copy = deepClone(args)
  let parent = copy
  for (const seg of m.path.slice(0, -1)) {
    const next = parent[seg]
    if (next === null || typeof next !== 'object') return null
    parent = next
  }
  const last = m.path[m.path.length - 1]
  if (m.op === 'delete') Reflect.deleteProperty(parent, last)
  else setOwn(parent, last, deserialize(m.value))
  return copy
}

// ---------------------------------------------------------------- sonde (§1 à §4)

function readJson(file) {
  try {
    return file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  } catch {
    return null
  }
}

/** État de la sonde ; `null` hors d'un run Varia (VARIA_MODE / VARIA_RUN_DIR absents). */
function initProbe(env) {
  const mode = env.VARIA_MODE
  if ((mode !== 'observe' && mode !== 'fuzz') || !env.VARIA_RUN_DIR) return null
  const targets = readJson(env.VARIA_TARGETS) || {}
  let mutation = null
  if (mode === 'fuzz') {
    const plan = readJson(env.VARIA_PLAN)
    mutation = ((plan && plan.mutations) || []).find((m) => m.id === env.VARIA_MUTATION_ID) || null
  }
  const regexps = (v, d) => (readJsonText(v) || d).map((s) => new RegExp(s))
  return {
    mode,
    runId: String(targets.runId || ''),
    root: String(targets.projectRoot || process.cwd()),
    logFile: path.join(env.VARIA_RUN_DIR, `probe-${process.pid}.jsonl`),
    redaction: compileRedaction(readJson(env.VARIA_REDACT) || {}),
    include: regexps(env.VARIA_INCLUDE, ['^src/.*$']),
    exclude: regexps(env.VARIA_EXCLUDE, []),
    mutation,
    als: new AsyncLocalStorage(),
    test: null,
    sequences: new Map(),
    calls: 0,
    rejected: false,
  }
}
function readJsonText(s) {
  try {
    return s ? JSON.parse(s) : null
  } catch {
    return null
  }
}

function emit(st, type, extra) {
  const line = JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    runId: st.runId,
    type,
    testId: st.test ? st.test.testId : null,
    timestamp: new Date().toISOString(),
    ...extra,
  })
  // Écrit et vidé avant de continuer : le journal survit à process.exit.
  fs.appendFileSync(st.logFile, line + '\n')
}

function probeError(st, reason, e, extra = {}) {
  try {
    emit(st, 'PROBE_ERROR', { reason, error: serializeError(e, []), ...extra })
  } catch {
    process.stderr.write(`[varia] PROBE_ERROR ${reason}\n`)
  }
}

function prepareCall(st, args, mod, exp) {
  const parent = st.als.getStore()
  const depth = parent ? parent.depth + 1 : 0
  const key = `${mod}#${exp}#${depth}`
  const sequence = st.sequences.get(key) || 0
  st.sequences.set(key, sequence + 1)
  const callSiteId = st.test ? callSiteIdOf(st.test.testId, mod, exp, depth, sequence) : null
  const callId = ++st.calls
  const secrets = []
  const opts = callOptions(st.redaction, exp, secrets)
  const serialized = serializeArgs(args, opts)
  const argsFingerprint = fingerprint(serialized)
  let callArgs = args
  let mutated = false
  const m = st.mutation
  if (m && callSiteId !== null && m.callSiteId === callSiteId) {
    const base = { callId, callSiteId, mutationId: m.id }
    if (m.argsFingerprint !== argsFingerprint)
      emit(st, 'MUTATE_CALL', {
        ...base,
        applied: false,
        reason: 'AMBIGUOUS_CALL_SITE',
        expectedFingerprint: m.argsFingerprint,
        argsFingerprint,
      })
    else {
      const next = applyMutation(args, m)
      if (next === null)
        emit(st, 'MUTATE_CALL', { ...base, applied: false, reason: 'PATH_NOT_FOUND' })
      else {
        callArgs = next
        mutated = true
        emit(st, 'MUTATE_CALL', { ...base, applied: true })
      }
    }
  }
  emit(st, 'OBSERVE_CALL', {
    callId,
    callSiteId,
    module: mod,
    export: exp,
    depth,
    sequence,
    argsFingerprint,
    mutated,
    ...(sequence < MAX_LOGGED_CALLS ? { args: serialized } : { argsOmitted: true }),
  })
  const chain = [...(parent ? parent.chain : []), callId]
  return { store: { depth, callId, callSiteId, chain, secrets }, callArgs, opts }
}

function wrapFunction(st, fn, mod, exp) {
  function wrapper(...args) {
    const invoke = (a) => (new.target ? Reflect.construct(fn, a, new.target) : fn.apply(this, a))
    let prep
    try {
      prep = prepareCall(st, args, mod, exp)
    } catch (e) {
      probeError(st, 'prepare', e, { module: mod, export: exp })
      return invoke(args)
    }
    const { store, callArgs, opts } = prep
    const started = performance.now()
    const outcome = (type, extra) => {
      try {
        emit(st, type, {
          callId: store.callId,
          callSiteId: store.callSiteId,
          durationMs: performance.now() - started,
          ...extra(),
        })
      } catch (e) {
        probeError(st, 'outcome', e, { callId: store.callId })
      }
    }
    const value = (v) => serialize(v, { ...opts, secrets: [] }, 'return')
    let result
    try {
      result = st.als.run(store, () => invoke(callArgs))
    } catch (e) {
      outcome('TARGET_THROW', () => ({ error: serializeError(e, store.secrets) }))
      throw e
    }
    if (
      result !== null &&
      typeof result === 'object' &&
      typeof safeGet(result, 'then') === 'function'
    ) {
      const derived = result.then(
        (v) => {
          outcome('TARGET_RETURN', () => ({ async: true, value: value(v) }))
          return v
        },
        (e) => {
          outcome('TARGET_REJECT', () => ({ error: serializeError(e, store.secrets) }))
          throw e
        },
      )
      Object.defineProperty(derived, CALL_TAG, { value: store, configurable: true })
      return derived
    }
    outcome('TARGET_RETURN', () => ({ async: false, value: value(result) }))
    return result
  }
  for (const k of Reflect.ownKeys(fn))
    if (k !== 'prototype' && k !== 'caller' && k !== 'arguments')
      Object.defineProperty(wrapper, k, Object.getOwnPropertyDescriptor(fn, k))
  if (typeof fn.prototype === 'object' && fn.prototype !== null)
    Object.defineProperty(wrapper, 'prototype', { value: fn.prototype, writable: true })
  wrapper[WRAPPED] = true
  return wrapper
}

const isClass = (f) => /^class[\s{]/.test(Function.prototype.toString.call(f))

/** Enveloppe les exports fonctions d'un module ciblé ; annonce DISCOVER. */
function wrapExports(st, exportsValue, mod) {
  const wrapped = []
  const unsupported = []
  let result = exportsValue
  if (typeof exportsValue === 'function') {
    if (isClass(exportsValue)) unsupported.push('default')
    else {
      result = wrapFunction(st, exportsValue, mod, 'default')
      wrapped.push('default')
    }
  }
  if (
    exportsValue !== null &&
    (typeof exportsValue === 'object' || typeof exportsValue === 'function')
  )
    for (const k of Object.keys(exportsValue)) {
      try {
        const d = Object.getOwnPropertyDescriptor(exportsValue, k)
        if (!('value' in d) || typeof d.value !== 'function' || d.value[WRAPPED]) continue
        if (isClass(d.value) || !(d.writable || d.configurable)) unsupported.push(k)
        else {
          Object.defineProperty(result, k, { ...d, value: wrapFunction(st, d.value, mod, k) })
          wrapped.push(k)
        }
      } catch (e) {
        probeError(st, 'wrap', e, { module: mod, export: k })
      }
    }
  emit(st, 'DISCOVER', { module: mod, wrapped, unsupported })
  return result
}

/** Rejets non gérés, attribués à l'appel de cible dont le contexte asynchrone a créé la promesse. */
function installRejectionHook(st) {
  createHook({
    init(_id, type, _trigger, resource) {
      if (type !== 'PROMISE') return
      const store = st.als.getStore()
      if (store !== undefined)
        Object.defineProperty(resource, CALL_TAG, { value: store, configurable: true })
    },
  }).enable()
  process.on('unhandledRejection', (reason, promise) => {
    st.rejected = true
    const tag =
      promise !== null && typeof promise === 'object' ? safeGet(promise, CALL_TAG) : undefined
    try {
      emit(st, 'UNHANDLED_REJECTION', {
        ...(tag ? { callId: tag.callId } : {}),
        callSiteId: tag ? tag.callSiteId : null,
        chain: tag ? tag.chain : [],
        error: serializeError(reason, tag ? tag.secrets : []),
      })
    } catch (e) {
      probeError(st, 'unhandled-rejection', e)
    }
  })
}

const posix = (root, file) => path.relative(root, file).split(path.sep).join('/')

function installRequireHook(st) {
  const original = Module._extensions['.js']
  Module._extensions['.js'] = function (module, filename) {
    original.call(this, module, filename)
    const rel = posix(st.root, filename)
    const target =
      !rel.startsWith('..') &&
      !rel.split('/').includes('node_modules') &&
      filename !== __filename &&
      st.include.some((re) => re.test(rel)) &&
      !st.exclude.some((re) => re.test(rel))
    if (target) module.exports = wrapExports(st, module.exports, rel)
  }
}

// ---------------------------------------------------------------- lanceur de tests

const registry = []
const suites = []
let loadingFile = ''

function register(title, fn) {
  registry.push({ file: loadingFile, name: [...suites, title].join(' '), fn })
}
function describe(title, fn) {
  suites.push(title)
  try {
    fn()
  } finally {
    suites.pop()
  }
}
const format = (spec, v) => (spec === '%p' || spec === '%j' ? JSON.stringify(v) : String(v))
function each(rows) {
  return (title, fn) =>
    rows.forEach((row, index) => {
      const args = Array.isArray(row) ? row : [row]
      let k = 0
      const name = title.replace(/%[sdifpj#%]/g, (s) =>
        s === '%%' ? '%' : s === '%#' ? String(index) : format(s, args[k++]),
      )
      register(name, () => fn(...args))
    })
}
const test = (title, fn) => register(title, fn)
test.each = each
function expect(v) {
  const has = (m) => (err) => m === undefined || String(err && err.message).includes(m)
  return {
    toBe: (e) => assert.strictEqual(v, e),
    toEqual: (e) => assert.deepStrictEqual(v, e),
    toThrow: (m) => assert.throws(v, has(m)),
    resolves: {
      toBe: async (e) => assert.strictEqual(await v, e),
      toEqual: async (e) => assert.deepStrictEqual(await v, e),
    },
    rejects: { toThrow: async (m) => assert.rejects(v, has(m)) },
  }
}

function findTests(root, dir = path.join(root, 'tests')) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : findTests(root, p)
      return /\.test\.c?js$/.test(e.name) ? [p] : []
    })
    .sort()
}

/** Écrit un fichier JSON d'un seul coup (fichier temporaire puis renommage). */
function writeAtomic(file, value) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value))
  fs.renameSync(file + '.tmp', file)
}

async function main(env) {
  const st = initProbe(env)
  const root = st ? st.root : process.cwd()
  if (st) {
    emit(st, 'HELLO', {
      protocolMinor: PROTOCOL_MINOR,
      mode: st.mode,
      pid: process.pid,
      mutationId: st.mutation ? st.mutation.id : null,
    })
    installRejectionHook(st)
    installRequireHook(st)
  }
  Object.assign(globalThis, { describe, it: test, test, expect })
  let files = findTests(root)
  if (env.VARIA_TEST_FILE) files = files.filter((f) => posix(root, f) === env.VARIA_TEST_FILE)
  for (const f of files) {
    loadingFile = posix(root, f)
    require(f)
  }
  if (env.VARIA_DISCOVER) {
    writeAtomic(env.VARIA_DISCOVER, {
      version: VERSION,
      tests: registry.map(({ file, name }) => ({ file, name })),
    })
    return 0
  }
  const ranks = new Map()
  const results = []
  for (const t of registry) {
    if (env.VARIA_TEST_NAME && t.name !== env.VARIA_TEST_NAME) continue
    const key = `${t.file}\u0000${t.name}`
    const rank = ranks.get(key) || 0
    ranks.set(key, rank + 1)
    if (st) {
      st.test = { testId: testIdOf(t.file, t.name, rank) }
      st.sequences = new Map()
      st.rejected = false
      emit(st, 'TEST_START', { file: t.file, name: t.name })
    }
    const started = performance.now()
    let status = 'passed'
    try {
      await t.fn()
    } catch (e) {
      status = 'failed'
      process.stderr.write(`✗ ${t.name} : ${str(e && e.message)}\n`)
    }
    if (st && st.rejected) status = 'failed'
    if (st) {
      emit(st, 'TEST_END', {})
      st.test = null
    }
    results.push({ file: t.file, name: t.name, status, durationMs: performance.now() - started })
  }
  if (env.VARIA_RESULTS) writeAtomic(env.VARIA_RESULTS, { tests: results })
  for (const r of results) process.stdout.write(`${r.status === 'passed' ? '✓' : '✗'} ${r.name}\n`)
  return results.every((r) => r.status === 'passed') ? 0 : 1
}

if (require.main === module)
  main(process.env).then(
    (code) => {
      process.exitCode = code
    },
    (e) => {
      process.stderr.write(`runner : ${str(e && e.stack)}\n`)
      process.exitCode = 2
    },
  )

// Fonctions du protocole, exposées pour le rejeu du jeu de conformité (packages/adapters/custom/test).
module.exports = {
  canonical,
  callOptions,
  callSiteIdOf,
  compileRedaction,
  fingerprint,
  serialize,
  serializeArgs,
  serializeError,
  sha256,
  testIdOf,
}
