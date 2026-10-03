// @ts-check
'use strict'
// Hôte des extensions (docs/extensions.md) : exécuté dans un `worker_threads` du processus Varia.
// Le thread ne sert PAS de bac à sable (même processus, mêmes droits) : il permet seulement à
// l'orchestrateur d'attendre une réponse avec un délai et d'arrêter une extension qui boucle
// (`worker.terminate()` interrompt même une boucle synchrone infinie).
// Protocole : l'orchestrateur envoie une requête sur `port`, attend `signal[0] = 1` (Atomics.wait,
// délai borné) puis lit la réponse par `receiveMessageOnPort`.

/**
 * @typedef {{ id: string }} Ext
 * @typedef {{ op: string, [k: string]: unknown }} Request
 * @typedef {{ ok: true, value: unknown, mathRandom?: boolean } | { ok: false, code: string, message: string, mathRandom?: boolean }} Response
 * @typedef {{ postMessage(v: unknown): void, on(e: 'message', fn: (v: Request) => void): unknown }} Port
 */

/** Même algorithme que `mulberry32` de @varia/core (un test compare les deux suites). */
function mulberry32(/** @type {number} */ seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const RANDOM = 'random'

/**
 * Exécute `fn` avec `Math.random` remplacé par une fonction qui lève (déterminisme, CDC §2) ; le
 * remplacement est temporaire (restauré même si `fn` lève). Un appel est signalé même si l'extension
 * rattrape l'exception.
 * @template T
 * @param {() => T} fn
 * @returns {{ value: T, mathRandom: boolean }}
 */
function withoutMathRandom(fn) {
  // Accès par `Reflect` : la règle de lint interdit toute lecture directe (le remplacer est le but).
  const original = Reflect.get(Math, RANDOM)
  let used = false
  Reflect.set(Math, RANDOM, () => {
    used = true
    throw new Error(
      'MATH_RANDOM_FORBIDDEN : utilisez ctx.random (générateur à graine fourni par Varia)',
    )
  })
  try {
    return { value: fn(), mathRandom: used }
  } catch (e) {
    throw Object.assign(asError(e), { mathRandom: used })
  } finally {
    Reflect.set(Math, RANDOM, original)
  }
}

/** @param {unknown} e */
function asError(e) {
  return e instanceof Error ? e : new Error(String(e))
}

/** Clés des collections d'extensions d'un plugin, par type. */
const KINDS = /** @type {const} */ ({
  strategy: 'strategies',
  rule: 'oracleRules',
  reporter: 'reporters',
  detector: 'formatDetectors',
})

/**
 * Crée l'état de l'hôte. `importer` charge un module (injecté : `import()` réel dans le thread).
 * @param {(url: string) => Promise<unknown>} importer
 */
function createHost(importer) {
  /** @type {Record<string, unknown> | null} */
  let plugin = null

  /**
   * Extension `id` du type `kind` (la première de ce nom : l'orchestrateur a refusé les doublons).
   * @param {keyof typeof KINDS} kind
   * @param {string} id
   * @returns {Record<string, unknown>}
   */
  const extension = (kind, id) => {
    const p = /** @type {Record<string, unknown>} */ (plugin)
    const list = /** @type {Record<string, unknown>[]} */ (p[KINDS[kind]])
    return /** @type {Record<string, unknown>} */ (list.find((x) => x['id'] === id))
  }

  /** @param {Record<string, unknown>} ext @param {string} name @param {unknown[]} args */
  const call = (ext, name, args) => {
    const fn = ext[name]
    if (typeof fn !== 'function') throw Object.assign(new Error(`${name} absent`), { shape: true })
    return fn.apply(ext, args)
  }

  /** Description du plugin : forme brute, validée par l'orchestrateur (jamais crue sur parole). */
  const describe = (/** @type {Record<string, unknown>} */ p) => {
    /** @type {Record<string, unknown[]>} */
    const lists = {}
    for (const [kind, key] of Object.entries(KINDS)) {
      const list = p[key]
      lists[kind] =
        list === undefined
          ? []
          : Array.isArray(list)
            ? list.map((x) =>
                x !== null && typeof x === 'object'
                  ? {
                      id: /** @type {Record<string, unknown>} */ (x)['id'],
                      extension: /** @type {Record<string, unknown>} */ (x)['extension'],
                    }
                  : { id: undefined },
              )
            : [{ id: undefined }]
    }
    return { apiVersion: p['apiVersion'], name: p['name'], ...lists }
  }

  /**
   * Charge le module d'extension et le décrit.
   * @param {string} url
   * @returns {Promise<Response>}
   */
  async function load(url) {
    const mod = /** @type {Record<string, unknown>} */ (await importer(url))
    const p = mod['default'] ?? mod
    if (p === null || typeof p !== 'object')
      return { ok: false, code: 'INVALID_SHAPE', message: 'export par défaut absent' }
    plugin = /** @type {Record<string, unknown>} */ (p)
    return { ok: true, value: describe(plugin) }
  }

  /**
   * Appelle une extension, `Math.random` interdit pendant l'appel.
   * @param {Request} req
   * @returns {Response}
   */
  function invoke(req) {
    const r = withoutMathRandom(() => run(req))
    return { ok: true, value: r.value, mathRandom: r.mathRandom }
  }

  /**
   * Traite une requête ; ne lève jamais (une erreur devient une réponse `ok: false`).
   * @param {Request} req
   * @returns {Promise<Response>}
   */
  async function handle(req) {
    try {
      return req.op === 'load' ? await load(String(req['url'])) : invoke(req)
    } catch (e) {
      const err = /** @type {Error & { shape?: boolean, mathRandom?: boolean }} */ (asError(e))
      return {
        ok: false,
        code: err.shape === true ? 'INVALID_SHAPE' : 'THROWN',
        message: `${err.name}: ${err.message}`,
        mathRandom: err.mathRandom === true,
      }
    }
  }

  /**
   * Opérations d'appel, par nom de requête (une opération inconnue lève : `THROWN`).
   * @type {Record<string, (req: Request, id: string) => unknown>}
   */
  const ops = {
    strategy: (req, id) => {
      const ext = extension('strategy', id)
      const seeds = /** @type {number[]} */ (req['seeds'])
      const limits = req['limits']
      return /** @type {unknown[]} */ (req['inputs']).map((input, i) => {
        const supported = call(ext, 'supports', [input])
        if (supported !== true) return supported === false ? null : { invalidSupports: true }
        const random = mulberry32(/** @type {number} */ (seeds[i]))
        return call(ext, 'generate', [input, { limits, random }])
      })
    },
    detector: (req, id) => {
      const ext = extension('detector', id)
      return /** @type {string[]} */ (req['values']).map((v) =>
        call(ext, 'detect', [v]) === true ? call(ext, 'invalidValues', [v]) : null,
      )
    },
    rule: (req, id) => call(extension('rule', id), 'evaluate', [req['input']]),
    reporter: (req, id) => call(extension('reporter', id), 'render', [req['report']]),
  }

  /** @param {Request} req */
  const run = (req) =>
    /** @type {(req: Request, id: string) => unknown} */ (ops[req.op])(req, String(req['id']))

  return { handle }
}

/**
 * Démarre l'hôte sur `port` : chaque réponse est postée PUIS signalée (`signal[0] = 1`). Une réponse
 * non clonable (fonction, symbole…) devient `INVALID_SHAPE`.
 * @param {{ port: Port, signal: SharedArrayBuffer }} data
 * @param {(url: string) => Promise<unknown>} [importer]
 */
function start(data, importer = (url) => import(url)) {
  const host = createHost(importer)
  const flag = new Int32Array(data.signal)
  data.port.on('message', (req) => {
    void host.handle(req).then((res) => {
      try {
        data.port.postMessage(res)
      } catch (e) {
        data.port.postMessage({
          ok: false,
          code: 'INVALID_SHAPE',
          message: `valeur non sérialisable : ${asError(e).message}`,
          mathRandom: res.mathRandom === true,
        })
      }
      Atomics.store(flag, 0, 1)
      Atomics.notify(flag, 0)
    })
  })
}

module.exports = { mulberry32, withoutMathRandom, createHost, start }
