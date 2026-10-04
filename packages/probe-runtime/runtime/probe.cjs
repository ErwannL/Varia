// @ts-check
'use strict'
// Sonde Varia (CDC §10, D.0) : fichier `setupFilesAfterEnv` éphémère, chargé dans chaque fichier de test
// Jest. Elle n'a aucune politique : elle observe, applique au plus UNE mutation, et écrit des JSONL.
// Elle est DÉFENSIVE (A-05) : toute erreur de son propre code (sérialisation d'un getter qui lève, Proxy
// hostile, disque plein) est signalée `PROBE_ERROR` et la cible est appelée SANS mutation, avec ses
// arguments d'origine ; l'erreur de la sonde n'atteint jamais le code testé.

const fs = require('fs')
const path = require('path')
const asyncHooks = require('async_hooks')
// Jest 24 n'expose pas le global `performance` dans l'environnement de test.
const { performance: perf } = require('perf_hooks')
const S = require('./serialize.cjs')

// Version du protocole (docs/probe-protocol.md) : majeure sur chaque ligne, mineure dans HELLO.
const PROTOCOL_VERSION = 1
const PROTOCOL_MINOR = 2
const MAX_LOGGED_CALLS = 20
const WRAPPED = Symbol.for('varia.wrapped')
/** Contexte d'appel porté par une promesse créée pendant l'appel d'une cible (attribution, A-02). */
const CALL_TAG = Symbol.for('varia.call')
/** Processus réel publié par le transform Jest (la sonde, dans le contexte vm, n'y a pas accès). */
const REAL_PROCESS = Symbol.for('varia.process')
/** Écouteur `unhandledRejection` unique par processus (partagé entre fichiers de test). */
const HOOK = Symbol.for('varia.rejectionHook')
/** Marqueur écrit sur stderr quand le journal lui-même est inaccessible (lu par l'orchestrateur). */
const STDERR_MARKER = '[varia] PROBE_ERROR'

/**
 * @typedef {object} PlanMutation
 * @property {string} id
 * @property {string} callSiteId
 * @property {string} argsFingerprint
 * @property {string[]} path
 * @property {'set' | 'delete'} op
 * @property {any} value
 */
/**
 * @typedef {object} CallStore contexte asynchrone d'un appel de cible
 * @property {number} depth
 * @property {number} callId
 * @property {string | null} callSiteId
 * @property {number[]} chain appels englobants, du plus externe au plus interne (lui compris)
 * @property {string[]} secrets valeurs brutes masquées (filtre des messages d'erreur)
 */
/**
 * @typedef {object} ProbeState
 * @property {string} mode
 * @property {string} runId
 * @property {string} logFile
 * @property {string} projectRoot
 * @property {import('async_hooks').AsyncLocalStorage<CallStore>} als
 * @property {PlanMutation | null} mutation
 * @property {Set<string>} redactFields
 * @property {RegExp[]} redactPatterns
 * @property {string[]} skipPaths
 * @property {string} hmacKey
 * @property {{ testId: string, file: string, name: string } | null} currentTest
 * @property {Map<string, number>} sequences
 * @property {Map<string, number>} nameCounts
 * @property {number} callCounter
 * @property {Set<string>} announced
 * @property {WeakMap<Function, Function>} wrappers enveloppe par fonction d'origine : un même export sous deux noms reste UNE fonction
 * @property {(line: string) => void} write écriture d'une ligne du journal (remplaçable en test)
 * @property {(s: string) => void} stderr
 * @property {() => string} now
 * @property {(m: unknown, id: string) => unknown} wrapExports
 * @property {(f: unknown, id: string, name: string) => unknown} wrapExport
 */

/** @param {string | undefined} file @returns {any} */
function readJson(file) {
  return file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

/**
 * État de la sonde à partir des variables d'environnement (CDC D.0) ; `null` hors d'un run Varia.
 * @param {Record<string, string | undefined>} env
 * @returns {ProbeState | null}
 */
function init(env) {
  const mode = env['VARIA_MODE']
  const runDir = env['VARIA_RUN_DIR']
  if ((mode !== 'observe' && mode !== 'fuzz') || !runDir) return null
  const redact = readJson(env['VARIA_REDACT']) ?? {}
  const targets = readJson(env['VARIA_TARGETS']) ?? {}
  let mutation = null
  if (mode === 'fuzz') {
    const plan = readJson(env['VARIA_PLAN'])
    const id = env['VARIA_MUTATION_ID']
    mutation = plan?.mutations?.find((/** @type {PlanMutation} */ m) => m.id === id) ?? null
  }
  const logFile = path.join(runDir, `probe-${process.pid}.jsonl`)
  /** @type {ProbeState} */
  const state = {
    mode,
    runId: String(targets.runId ?? ''),
    logFile,
    projectRoot: String(targets.projectRoot ?? process.cwd()),
    als: new asyncHooks.AsyncLocalStorage(),
    mutation,
    ...S.compileRedaction(redact),
    currentTest: null,
    sequences: new Map(),
    nameCounts: new Map(),
    callCounter: 0,
    announced: new Set(),
    wrappers: new WeakMap(),
    // appendFileSync : chaque ligne est écrite (et vidée) avant de continuer ; survit à process.exit.
    write: (line) => fs.appendFileSync(logFile, line),
    stderr: (s) => process.stderr.write(s),
    now: () => new Date().toISOString(),
    wrapExports,
    wrapExport,
  }
  return state
}

/** @param {ProbeState} st @param {string} type @param {Record<string, unknown>} fields */
function emit(st, type, fields) {
  const msg = {
    protocolVersion: PROTOCOL_VERSION,
    runId: st.runId,
    type,
    testId: st.currentTest?.testId ?? null,
    timestamp: st.now(),
    ...fields,
  }
  st.write(JSON.stringify(msg) + '\n')
}

/**
 * Signale une erreur du code de la sonde (jamais propagée à la cible). Si le journal lui-même est
 * inaccessible, un marqueur est écrit sur stderr : l'orchestrateur ne croit jamais un run muet.
 * @param {ProbeState} st @param {string} stage @param {unknown} e @param {Record<string, unknown>} [extra]
 */
function probeError(st, stage, e, extra = {}) {
  try {
    emit(st, 'PROBE_ERROR', { reason: stage, error: serializeError(e, []), ...extra })
  } catch {
    try {
      st.stderr(`${STDERR_MARKER} ${stage}\n`)
    } catch {
      // stderr fermé : plus aucun canal ; l'absence d'issue de la cible sera classée par l'oracle.
    }
  }
}

/** Lecture défensive d'une propriété (getter qui lève, Proxy hostile). @param {any} o @param {PropertyKey} k */
function safeGet(o, k) {
  try {
    return o[k]
  } catch {
    return undefined
  }
}

/**
 * Forme sérialisée d'une erreur (D.0) ; les chaînes masquées sont retirées du message et de la pile.
 * Ne lève jamais : une erreur hostile (getters qui lèvent) donne des champs vides.
 * @param {unknown} e @param {string[]} secrets
 */
function serializeError(e, secrets) {
  const scrub = (/** @type {string} */ s) =>
    secrets.reduce((acc, x) => acc.split(x).join('[REDACTED]'), s)
  const str = (/** @type {unknown} */ v) => {
    try {
      return String(v)
    } catch {
      return ''
    }
  }
  if (e === null || typeof e !== 'object')
    return { name: typeof e, message: scrub(str(e)), stack: '', constructorChain: [] }
  const chain = []
  try {
    for (
      let p = Object.getPrototypeOf(e);
      p !== null && chain.length < 10;
      p = Object.getPrototypeOf(p)
    ) {
      const name = safeGet(safeGet(p, 'constructor'), 'name')
      if (typeof name === 'string' && name !== 'Object') chain.push(name)
    }
  } catch {
    // Proxy dont getPrototypeOf lève : chaîne partielle.
  }
  const rawStack = safeGet(e, 'stack')
  const stack = typeof rawStack === 'string' ? rawStack : ''
  const frames = stack
    .split('\n')
    .slice(1)
    .filter(
      (l) => !l.includes(__dirname) && !l.includes('node:internal') && !l.includes('/jest-circus/'),
    )
    .slice(0, 15)
  const code = safeGet(e, 'code')
  // `status` non numérique (« abc », symbole) : omis, jamais `null` (hors schéma, P-01).
  const status = num(safeGet(e, 'status'))
  return {
    name: scrub(str(safeGet(e, 'name') ?? '')),
    message: scrub(str(safeGet(e, 'message') ?? '')),
    ...(code !== undefined ? { code: str(code) } : {}),
    ...(Number.isFinite(status) ? { status } : {}),
    stack: scrub(frames.join('\n')),
    constructorChain: chain,
  }
}

/** Conversion numérique qui ne lève jamais (symbole) ; `undefined` ⇒ NaN. @param {unknown} v */
function num(v) {
  try {
    return Number(v)
  } catch {
    return NaN
  }
}

/** Copie profonde qui conserve les prototypes (jamais de modification en place). @param {unknown} v @param {Map<object, unknown>} seen @returns {unknown} */
function deepClone(v, seen = new Map()) {
  if (v === null || typeof v !== 'object') return v
  if (seen.has(v)) return seen.get(v)
  const type = S.typeOf(v)
  if (type === 'date') return new Date(/** @type {Date} */ (v).getTime())
  if (type === 'regexp') return new RegExp(/** @type {RegExp} */ (v))
  if (type === 'bytes') return Buffer.from(/** @type {Uint8Array} */ (v))
  if (type === 'map') {
    const m = new Map()
    seen.set(v, m)
    for (const [k, x] of /** @type {Map<unknown, unknown>} */ (v)) m.set(k, deepClone(x, seen))
    return m
  }
  if (type === 'set') {
    const s = new Set()
    seen.set(v, s)
    for (const x of /** @type {Set<unknown>} */ (v)) s.add(deepClone(x, seen))
    return s
  }
  const out = Array.isArray(v) ? new Array(v.length) : Object.create(Object.getPrototypeOf(v))
  seen.set(v, out)
  for (const key of Reflect.ownKeys(v)) {
    // `length` d'un tableau : implicite (`new Array(v.length)`), non reconfigurable.
    if (Array.isArray(v) && key === 'length') continue
    const d = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(v, key))
    if ('value' in d) {
      d.value = deepClone(d.value, seen)
      d.writable = true
    }
    // La COPIE est modifiable même si l'original est figé (`Object.freeze`, constaté sur le frontend d'Orqea) :
    // sinon la mutation d'un argument figé échouait (« Cannot redefine property ») et finissait en INFRA_ERROR.
    d.configurable = true
    Object.defineProperty(out, key, d)
  }
  return out
}

/** Applique UNE mutation sur une copie des arguments. @param {unknown[]} args @param {PlanMutation} m */
function applyMutation(args, m) {
  const copy = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (deepClone(args)))
  let parent = copy
  for (const seg of m.path.slice(0, -1)) {
    const next = parent[seg]
    if (next === null || typeof next !== 'object') return null
    parent = /** @type {Record<string, unknown>} */ (next)
  }
  const last = /** @type {string} */ (m.path[m.path.length - 1])
  if (m.op === 'delete') Reflect.deleteProperty(parent, last)
  // Clé propre, jamais une écriture de prototype (`__proto__` est une donnée, A-01).
  else
    Object.defineProperty(parent, last, {
      value: S.deserialize(m.value),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  return /** @type {unknown[]} */ (/** @type {unknown} */ (copy))
}

/**
 * Processus réel publié par le transform Jest (qui s'exécute hors du contexte vm) ; `null` s'il ne
 * l'est pas (transform pas encore chargé, ou runner sans transform : Vitest passe `process` à install).
 * @returns {NodeJS.Process | null}
 */
function publishedProcess() {
  return /** @type {any} */ (asyncHooks)[REAL_PROCESS] ?? null
}

/**
 * Rejet de promesse non géré (CDC §10.8, §18.8, A-02) : attribué à l'appel de cible dans le contexte
 * asynchrone duquel la promesse a été créée (étiquette posée par le crochet `init`).
 * @param {ProbeState} st @param {unknown} reason @param {unknown} promise
 */
function onUnhandledRejection(st, reason, promise) {
  /** @type {CallStore | undefined} */
  const tag =
    promise !== null && typeof promise === 'object' ? safeGet(promise, CALL_TAG) : undefined
  try {
    emit(st, 'UNHANDLED_REJECTION', {
      ...(tag !== undefined ? { callId: tag.callId } : {}),
      callSiteId: tag?.callSiteId ?? null,
      chain: tag?.chain ?? [],
      error: serializeError(reason, tag?.secrets ?? []),
    })
  } catch (e) {
    probeError(st, 'unhandled-rejection', e)
  }
}

/**
 * Installe (une fois par processus) l'écouteur `unhandledRejection` et le crochet qui étiquette les
 * promesses créées pendant un appel de cible ; l'état courant est mis à jour à chaque fichier de test.
 * Sous Jest, sans processus réel publié (transform pas encore chargé), rien n'est installé : un
 * écouteur sur la copie vm du processus ne recevrait rien. Renvoie `true` si l'écoute est active.
 * @param {ProbeState} st @param {NodeJS.Process | null} proc
 */
function installRejectionHook(st, proc) {
  if (proc === null) return false
  const p = /** @type {any} */ (proc)
  /** @type {{ st: ProbeState } | undefined} */
  const existing = p[HOOK]
  if (existing !== undefined) {
    existing.st = st
    return true
  }
  const holder = { st }
  Object.defineProperty(p, HOOK, { value: holder })
  proc.on('unhandledRejection', (reason, promise) => {
    onUnhandledRejection(holder.st, reason, promise)
    // Seul écouteur : comportement par défaut de Node conservé (le rejet devient une exception).
    if (proc.listenerCount('unhandledRejection') === 1) throw reason
  })
  asyncHooks
    .createHook({
      init(_id, type, _trigger, resource) {
        if (type !== 'PROMISE') return
        const store = holder.st.als.getStore()
        if (store !== undefined)
          Object.defineProperty(resource, CALL_TAG, { value: store, configurable: true })
      },
    })
    .enable()
  return true
}

/**
 * Préparation d'un appel (observation, mutation) : peut lever (valeurs hostiles), jamais la cible.
 * @param {ProbeState} st @param {unknown[]} args @param {string} moduleId @param {string} exportName
 */
function prepareCall(st, args, moduleId, exportName) {
  const parent = st.als.getStore()
  const depth = parent ? parent.depth + 1 : 0
  const test = st.currentTest
  const seqKey = `${moduleId}#${exportName}#${depth}`
  const sequence = st.sequences.get(seqKey) ?? 0
  st.sequences.set(seqKey, sequence + 1)
  const callSiteId = test
    ? S.callSiteIdOf(test.testId, moduleId, exportName, depth, sequence)
    : null
  const callId = ++st.callCounter
  /** @type {string[]} */
  const secrets = []
  const opts = S.argsOptions(st, exportName, secrets)
  const serialized = S.serializeArgs(args, opts)
  const argsFingerprint = S.fingerprint(serialized)
  let callArgs = args
  let mutated = false
  const m = st.mutation
  if (m && callSiteId !== null && callSiteId === m.callSiteId) {
    if (argsFingerprint !== m.argsFingerprint) {
      emit(st, 'MUTATE_CALL', {
        callId,
        callSiteId,
        mutationId: m.id,
        applied: false,
        reason: 'AMBIGUOUS_CALL_SITE',
        expectedFingerprint: m.argsFingerprint,
        argsFingerprint,
      })
    } else {
      const next = applyMutation(args, m)
      if (next === null) {
        emit(st, 'MUTATE_CALL', {
          callId,
          callSiteId,
          mutationId: m.id,
          applied: false,
          reason: 'PATH_NOT_FOUND',
        })
      } else {
        callArgs = next
        mutated = true
        emit(st, 'MUTATE_CALL', { callId, callSiteId, mutationId: m.id, applied: true })
      }
    }
  }
  emit(st, 'OBSERVE_CALL', {
    callId,
    callSiteId,
    module: moduleId,
    export: exportName,
    depth,
    sequence,
    argsFingerprint,
    mutated,
    ...(sequence < MAX_LOGGED_CALLS ? { args: serialized } : { argsOmitted: true }),
  })
  /** @type {CallStore} */
  const store = {
    depth,
    callId,
    callSiteId,
    chain: [...(parent?.chain ?? []), callId],
    secrets,
  }
  return { store, callArgs, opts }
}

/** @param {unknown} v */
function isThenable(v) {
  return v !== null && typeof v === 'object' && typeof safeGet(v, 'then') === 'function'
}

/** @param {ProbeState} st @param {Function} fn @param {string} moduleId @param {string} exportName */
function wrapFunction(st, fn, moduleId, exportName) {
  // Un même export sous deux noms (`default` et nommé, ré-export) est UNE fonction : une seule enveloppe,
  // sinon `a.default === a.nommé` devient faux sous la sonde (constaté sur le frontend d'Orqea).
  const known = st.wrappers.get(fn)
  if (known !== undefined) return known
  /** @this {unknown} @param {unknown[]} args */
  function variaWrapper(...args) {
    const invoke = (/** @type {unknown[]} */ a) =>
      new.target ? Reflect.construct(fn, a, new.target) : fn.apply(this, a)
    let prepared
    try {
      prepared = prepareCall(st, args, moduleId, exportName)
    } catch (e) {
      // Échec de la sonde : appel d'origine, sans mutation ni observation (A-05).
      probeError(st, 'prepare', e, { module: moduleId, export: exportName })
      return invoke(args)
    }
    const { store, callArgs, opts } = prepared
    const started = perf.now()
    const outcome = (
      /** @type {string} */ type,
      /** @type {() => Record<string, unknown>} */ extra,
    ) => {
      try {
        emit(st, type, {
          callId: store.callId,
          callSiteId: store.callSiteId,
          durationMs: perf.now() - started,
          ...extra(),
        })
      } catch (e) {
        probeError(st, 'outcome', e, { callId: store.callId })
      }
    }
    const ser = (/** @type {unknown} */ v) => S.serialize(v, { ...opts, secrets: [] }, 'return')
    let result
    try {
      result = st.als.run(store, () => invoke(callArgs))
    } catch (e) {
      outcome('TARGET_THROW', () => ({ error: serializeError(e, store.secrets) }))
      throw e
    }
    if (isThenable(result)) {
      const derived = /** @type {Promise<unknown>} */ (result).then(
        (value) => {
          outcome('TARGET_RETURN', () => ({ async: true, value: ser(value) }))
          return value
        },
        (e) => {
          outcome('TARGET_REJECT', () => ({ error: serializeError(e, store.secrets) }))
          throw e
        },
      )
      // La promesse rendue au test porte l'appel : un rejet que personne n'attend lui est attribué.
      Object.defineProperty(derived, CALL_TAG, { value: store, configurable: true })
      return derived
    }
    outcome('TARGET_RETURN', () => ({ async: false, value: ser(result) }))
    return result
  }
  for (const key of Reflect.ownKeys(fn)) {
    if (key === 'prototype' || key === 'caller' || key === 'arguments') continue
    const d = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(fn, key))
    Object.defineProperty(variaWrapper, key, d)
  }
  // Constructeur (ES5 ou classe compilée) : `new enveloppe()` doit produire une instance de `fn` ;
  // l'enveloppe partage donc le prototype de `fn` (instanceof préservé, méthodes disponibles).
  if (typeof fn.prototype === 'object' && fn.prototype !== null) {
    Object.defineProperty(variaWrapper, 'prototype', { value: fn.prototype, writable: true })
  }
  Object.defineProperty(variaWrapper, WRAPPED, { value: fn })
  st.wrappers.set(fn, variaWrapper)
  return variaWrapper
}

/** @param {unknown} fn */
const isClass = (fn) =>
  typeof fn === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(fn))

/**
 * Enveloppe les exports fonctions d'un module (appelé par le code ajouté par le transform). Un export
 * que la sonde ne parvient pas à envelopper reste intact (`PROBE_ERROR`, jamais une erreur du module).
 * @param {unknown} exportsValue @param {string} moduleId @returns {unknown}
 */
function wrapExports(exportsValue, moduleId) {
  const st = /** @type {ProbeState} */ (/** @type {any} */ (globalThis).__varia)
  installRejectionHook(st, publishedProcess())
  /** @type {string[]} */
  const wrapped = []
  /** @type {string[]} */
  const unsupported = []
  let result = exportsValue
  if (typeof exportsValue === 'function' && !(WRAPPED in exportsValue)) {
    if (isClass(exportsValue)) unsupported.push('default')
    else {
      result = wrapFunction(st, exportsValue, moduleId, 'default')
      wrapped.push('default')
    }
  }
  const holder = /** @type {Record<string, unknown>} */ (exportsValue)
  if (
    exportsValue !== null &&
    (typeof exportsValue === 'object' || typeof exportsValue === 'function')
  ) {
    let keys = /** @type {string[]} */ ([])
    try {
      keys = Object.keys(holder)
    } catch (e) {
      probeError(st, 'wrap', e, { module: moduleId, export: '*' })
    }
    for (const key of keys) {
      try {
        wrapKey(st, holder, result, key, moduleId, wrapped, unsupported)
      } catch (e) {
        probeError(st, 'wrap', e, { module: moduleId, export: key })
      }
    }
  }
  if (!st.announced.has(moduleId)) {
    st.announced.add(moduleId)
    emit(st, 'DISCOVER', { module: moduleId, wrapped, unsupported })
  }
  return result
}

/**
 * @param {ProbeState} st @param {Record<string, unknown>} holder @param {unknown} result
 * @param {string} key @param {string} moduleId @param {string[]} wrapped @param {string[]} unsupported
 */
function wrapKey(st, holder, result, key, moduleId, wrapped, unsupported) {
  const d = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(holder, key))
  const target = result === holder ? holder : /** @type {Record<string, unknown>} */ (result)
  if ('value' in d && typeof d.value === 'function' && !(WRAPPED in d.value)) {
    if (isClass(d.value)) unsupported.push(key)
    else if (d.writable || d.configurable) {
      Object.defineProperty(target, key, { ...d, value: wrapFunction(st, d.value, moduleId, key) })
      wrapped.push(key)
    } else unsupported.push(key)
  } else if (d.get && d.configurable) {
    const getter = d.get
    /** @type {Map<unknown, unknown>} */
    const cache = new Map()
    Object.defineProperty(target, key, {
      ...d,
      get() {
        const v = getter.call(this)
        if (typeof v !== 'function' || isClass(v) || WRAPPED in v) return v
        if (!cache.has(v)) cache.set(v, wrapFunction(st, v, moduleId, key))
        return cache.get(v)
      },
    })
    wrapped.push(key)
  }
}

/**
 * Enveloppe UN export (modules ESM réécrits par le plugin Vitest) ; annonce l'export découvert.
 * @param {unknown} fn @param {string} moduleId @param {string} exportName @returns {unknown}
 */
function wrapExport(fn, moduleId, exportName) {
  const st = /** @type {ProbeState} */ (/** @type {any} */ (globalThis).__varia)
  if (typeof fn !== 'function' || WRAPPED in fn) return fn
  if (isClass(fn)) {
    emit(st, 'DISCOVER', { module: moduleId, wrapped: [], unsupported: [exportName] })
    return fn
  }
  emit(st, 'DISCOVER', { module: moduleId, wrapped: [exportName], unsupported: [] })
  return wrapFunction(st, fn, moduleId, exportName)
}

/**
 * @typedef {object} TestHooks
 * @property {(fn: () => void) => void} beforeEach
 * @property {(fn: () => void) => void} afterEach
 * @property {() => { testPath?: string, currentTestName?: string }} getState
 * @property {(s: { currentTestName?: string }) => string} [nameOf] nom complet du test (Vitest : « a > b » → « a b »)
 * @property {NodeJS.Process | null} [process] processus réel (Vitest) ; absent sous Jest
 */

/** Branche la sonde sur les crochets du runner (Jest : globaux ; Vitest : API importée). Une fois par fichier de test. */
function install(/** @type {TestHooks} */ hooks) {
  installOn(globalThis, hooks)
}

/** @param {any} g objet global portant l'état @param {TestHooks} hooks */
function installOn(g, hooks) {
  const st = /** @type {ProbeState | null} */ (g.__varia)
  if (!st) return
  emit(st, 'HELLO', {
    protocolMinor: PROTOCOL_MINOR,
    mode: st.mode,
    pid: process.pid,
    mutationId: st.mutation?.id ?? null,
  })
  installRejectionHook(st, hooks.process ?? null)
  hooks.beforeEach(() => {
    const cur = /** @type {ProbeState} */ (g.__varia)
    const es = hooks.getState()
    const file = path
      .relative(cur.projectRoot, String(es.testPath ?? ''))
      .split(path.sep)
      .join('/')
    const name = hooks.nameOf ? hooks.nameOf(es) : String(es.currentTestName ?? '')
    const key = `${file}\u0000${name}`
    const dup = cur.nameCounts.get(key) ?? 0
    cur.nameCounts.set(key, dup + 1)
    cur.currentTest = { testId: S.testIdOf(file, name, dup), file, name }
    cur.sequences = new Map()
    emit(cur, 'TEST_START', { file, name })
  })
  hooks.afterEach(() => {
    const cur = /** @type {ProbeState} */ (g.__varia)
    emit(cur, 'TEST_END', {})
    cur.currentTest = null
  })
}

/**
 * Démarrage dans un processus de test : état sur `globalThis.__varia` (survit à `jest.resetModules`),
 * puis branchement automatique sous Jest (globaux `beforeEach` et `expect.getState`).
 * @param {any} g objet global @param {Record<string, string | undefined>} env
 */
function boot(g, env) {
  if (!g.__varia) g.__varia = init(env)
  if (g.__varia && typeof g.beforeEach === 'function' && typeof g.expect?.getState === 'function')
    installOn(g, {
      beforeEach: g.beforeEach,
      afterEach: g.afterEach,
      getState: () => g.expect.getState(),
    })
}

boot(globalThis, process.env)

module.exports = {
  install,
  // Exposés pour les tests en processus de la sonde (F-03).
  internals: {
    applyMutation,
    boot,
    CALL_TAG,
    deepClone,
    emit,
    init,
    installRejectionHook,
    onUnhandledRejection,
    probeError,
    publishedProcess,
    REAL_PROCESS,
    serializeError,
    STDERR_MARKER,
    wrapExport,
    wrapExports,
    wrapFunction,
  },
}
