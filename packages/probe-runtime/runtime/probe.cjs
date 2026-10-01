// @ts-check
'use strict'
// Sonde Varia (CDC §10, D.0) : fichier `setupFilesAfterEnv` éphémère, chargé dans chaque fichier de test
// Jest. Elle n'a aucune politique : elle observe, applique au plus UNE mutation, et écrit des JSONL.

const fs = require('node:fs')
const path = require('node:path')
const { AsyncLocalStorage } = require('node:async_hooks')
const S = require('./serialize.cjs')

const PROTOCOL_VERSION = 1
const MAX_LOGGED_CALLS = 20
const WRAPPED = Symbol.for('varia.wrapped')

/** @typedef {import('./serialize.cjs').stableStringify} _ */
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
 * @typedef {object} ProbeState
 * @property {string} mode
 * @property {string} runId
 * @property {string} logFile
 * @property {string} projectRoot
 * @property {AsyncLocalStorage<{ depth: number }>} als
 * @property {PlanMutation | null} mutation
 * @property {Set<string>} redactFields
 * @property {string[]} skipPaths
 * @property {string} hmacKey
 * @property {{ testId: string, file: string, name: string } | null} currentTest
 * @property {Map<string, number>} sequences
 * @property {Map<string, number>} nameCounts
 * @property {number} callCounter
 * @property {Set<string>} announced
 * @property {(m: unknown, id: string) => unknown} wrapExports
 */

/** @param {string | undefined} file @returns {any} */
function readJson(file) {
  return file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

/** @returns {ProbeState | null} */
function init() {
  const mode = process.env['VARIA_MODE']
  const runDir = process.env['VARIA_RUN_DIR']
  if ((mode !== 'observe' && mode !== 'fuzz') || !runDir) return null
  const redact = readJson(process.env['VARIA_REDACT']) ?? {}
  const targets = readJson(process.env['VARIA_TARGETS']) ?? {}
  let mutation = null
  if (mode === 'fuzz') {
    const plan = readJson(process.env['VARIA_PLAN'])
    const id = process.env['VARIA_MUTATION_ID']
    mutation = plan?.mutations?.find((/** @type {PlanMutation} */ m) => m.id === id) ?? null
  }
  /** @type {ProbeState} */
  const state = {
    mode,
    runId: String(targets.runId ?? ''),
    logFile: path.join(runDir, `probe-${process.pid}.jsonl`),
    projectRoot: String(targets.projectRoot ?? process.cwd()),
    als: new AsyncLocalStorage(),
    mutation,
    redactFields: new Set((redact.fields ?? []).map((/** @type {string} */ f) => f.toLowerCase())),
    skipPaths: redact.skipPaths ?? [],
    hmacKey: String(redact.hmacKey ?? 'varia'),
    currentTest: null,
    sequences: new Map(),
    nameCounts: new Map(),
    callCounter: 0,
    announced: new Set(),
    wrapExports,
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
    timestamp: new Date().toISOString(),
    ...fields,
  }
  // appendFileSync : chaque ligne est écrite (et vidée) avant de continuer ; survit à process.exit.
  fs.appendFileSync(st.logFile, JSON.stringify(msg) + '\n')
}

/** @param {unknown} e @param {string[]} secrets */
function serializeError(e, secrets) {
  const scrub = (/** @type {string} */ s) =>
    secrets.reduce((acc, x) => acc.split(x).join('[REDACTED]'), s)
  if (e === null || typeof e !== 'object')
    return { name: typeof e, message: scrub(String(e)), constructorChain: [] }
  const err = /** @type {Record<string, unknown>} */ (e)
  const chain = []
  for (
    let p = Object.getPrototypeOf(e);
    p !== null && chain.length < 10;
    p = Object.getPrototypeOf(p)
  ) {
    const name = p.constructor?.name
    if (typeof name === 'string' && name !== 'Object') chain.push(name)
  }
  const stack = typeof err['stack'] === 'string' ? err['stack'] : ''
  const frames = stack
    .split('\n')
    .slice(1)
    .filter(
      (l) => !l.includes(__dirname) && !l.includes('node:internal') && !l.includes('/jest-circus/'),
    )
    .slice(0, 15)
  return {
    name: scrub(String(err['name'] ?? '')),
    message: scrub(String(err['message'] ?? '')),
    ...(err['code'] !== undefined ? { code: String(err['code']) } : {}),
    ...(err['status'] !== undefined ? { status: Number(err['status']) } : {}),
    stack: scrub(frames.join('\n')),
    constructorChain: chain,
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
    const d = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(v, key))
    if ('value' in d) d.value = deepClone(d.value, seen)
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
  else parent[last] = S.deserialize(m.value)
  return /** @type {unknown[]} */ (/** @type {unknown} */ (copy))
}

/** @param {ProbeState} st @param {Function} fn @param {string} moduleId @param {string} exportName */
function wrapFunction(st, fn, moduleId, exportName) {
  /** @this {unknown} @param {unknown[]} args */
  function variaWrapper(...args) {
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
    const redactPaths = new Set(
      st.skipPaths
        .filter((p) => p.startsWith(`${exportName}#`))
        .map((p) => p.slice(exportName.length + 1)),
    )
    const opts = { redactFields: st.redactFields, redactPaths, hmacKey: st.hmacKey, secrets }
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
    const started = performance.now()
    const outcome = (/** @type {string} */ type, /** @type {Record<string, unknown>} */ extra) =>
      emit(st, type, { callId, callSiteId, durationMs: performance.now() - started, ...extra })
    const ser = (/** @type {unknown} */ v) => S.serialize(v, { ...opts, secrets: [] }, 'return')
    let result
    try {
      result = st.als.run({ depth }, () =>
        new.target ? Reflect.construct(fn, callArgs, new.target) : fn.apply(this, callArgs),
      )
    } catch (e) {
      outcome('TARGET_THROW', { error: serializeError(e, secrets) })
      throw e
    }
    if (
      result !== null &&
      typeof result === 'object' &&
      typeof (/** @type {any} */ (result).then) === 'function'
    ) {
      return /** @type {Promise<unknown>} */ (result).then(
        (value) => {
          outcome('TARGET_RETURN', { async: true, value: ser(value) })
          return value
        },
        (e) => {
          outcome('TARGET_REJECT', { error: serializeError(e, secrets) })
          throw e
        },
      )
    }
    outcome('TARGET_RETURN', { async: false, value: ser(result) })
    return result
  }
  for (const key of Reflect.ownKeys(fn)) {
    if (key === 'prototype' || key === 'caller' || key === 'arguments') continue
    const d = Object.getOwnPropertyDescriptor(fn, key)
    if (d) Object.defineProperty(variaWrapper, key, d)
  }
  Object.defineProperty(variaWrapper, WRAPPED, { value: fn })
  return variaWrapper
}

/** @param {unknown} fn */
const isClass = (fn) =>
  typeof fn === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(fn))

/**
 * Enveloppe les exports fonctions d'un module (appelé par le code ajouté par le transform).
 * @param {unknown} exportsValue @param {string} moduleId @returns {unknown}
 */
function wrapExports(exportsValue, moduleId) {
  const st = /** @type {ProbeState} */ (/** @type {any} */ (globalThis).__varia)
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
    for (const key of Object.keys(holder)) {
      const d = Object.getOwnPropertyDescriptor(holder, key)
      if (!d) continue
      const target =
        result === exportsValue ? holder : /** @type {Record<string, unknown>} */ (result)
      if ('value' in d && typeof d.value === 'function' && !(WRAPPED in d.value)) {
        if (isClass(d.value)) unsupported.push(key)
        else if (d.writable || d.configurable) {
          Object.defineProperty(target, key, {
            ...d,
            value: wrapFunction(st, d.value, moduleId, key),
          })
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
  }
  if (!st.announced.has(moduleId)) {
    st.announced.add(moduleId)
    emit(st, 'DISCOVER', { module: moduleId, wrapped, unsupported })
  }
  return result
}

const g = /** @type {any} */ (globalThis)
if (!g.__varia) g.__varia = init()
const state = /** @type {ProbeState | null} */ (g.__varia)

if (state) {
  emit(state, 'HELLO', {
    mode: state.mode,
    pid: process.pid,
    mutationId: state.mutation?.id ?? null,
  })
  g.beforeEach(() => {
    const st = /** @type {ProbeState} */ (g.__varia)
    const es = g.expect.getState()
    const file = path
      .relative(st.projectRoot, String(es.testPath ?? ''))
      .split(path.sep)
      .join('/')
    const name = String(es.currentTestName ?? '')
    const key = `${file}\u0000${name}`
    const dup = st.nameCounts.get(key) ?? 0
    st.nameCounts.set(key, dup + 1)
    st.currentTest = { testId: S.testIdOf(file, name, dup), file, name }
    st.sequences = new Map()
    emit(st, 'TEST_START', { file, name })
  })
  g.afterEach(() => {
    const st = /** @type {ProbeState} */ (g.__varia)
    emit(st, 'TEST_END', {})
    st.currentTest = null
  })
}
