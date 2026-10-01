// @ts-check
'use strict'
// Transform Jest temporaire (stratégie D1, CDC §10.0) : délègue au transform d'origine du projet,
// puis ajoute en fin de module l'appel `__varia.wrapExports` pour les fichiers `targets.include`.
// L'ajout se fait APRÈS la dernière ligne : les numéros de ligne et la source map restent valides.

const nodeCrypto = require('node:crypto')
const path = require('node:path')

/**
 * @typedef {object} VariaTransformConfig
 * @property {string | null} original chemin absolu du transform d'origine (null : aucun)
 * @property {unknown} originalConfig configuration du transform d'origine
 * @property {string[]} include expressions régulières (sources) sur le chemin relatif au projet
 * @property {string[]} exclude
 * @property {string} projectRoot
 * @property {string} salt sel de cache propre au run
 */

/** @param {VariaTransformConfig} cfg */
function createTransformer(cfg) {
  /** @type {any} */
  let original = null
  if (cfg.original) {
    const mod = require(cfg.original)
    const factory = mod.createTransformer ?? mod.default?.createTransformer
    original = typeof factory === 'function' ? factory(cfg.originalConfig) : (mod.default ?? mod)
  }
  const include = cfg.include.map((s) => new RegExp(s))
  const exclude = cfg.exclude.map((s) => new RegExp(s))
  /** @param {string} filename */
  const moduleIdOf = (filename) =>
    path.relative(cfg.projectRoot, filename).split(path.sep).join('/')
  /** @param {string} filename */
  const targeted = (filename) => {
    const rel = moduleIdOf(filename)
    return (
      !rel.startsWith('..') &&
      !rel.split('/').includes('node_modules') &&
      include.some((r) => r.test(rel)) &&
      !exclude.some((r) => r.test(rel))
    )
  }
  /** @param {any} options */
  const delegateOptions = (options) => ({ ...options, transformerConfig: cfg.originalConfig })
  /** @param {unknown} r @param {string} src */
  const normalize = (r, src) =>
    r === undefined
      ? { code: src }
      : typeof r === 'string'
        ? { code: r }
        : /** @type {{ code: string, map?: unknown }} */ (r)
  /** @param {{ code: string, map?: unknown }} r @param {string} filename */
  const finish = (r, filename) => {
    if (!targeted(filename)) return r
    const footer =
      '\n;(function(m){var v=globalThis.__varia;if(v&&typeof v.wrapExports==="function"&&m&&m.exports!==undefined){m.exports=v.wrapExports(m.exports,' +
      JSON.stringify(moduleIdOf(filename)) +
      ')}})(typeof module!=="undefined"?module:undefined);\n'
    return { ...r, code: r.code + footer }
  }
  return {
    canInstrument: Boolean(original?.canInstrument),
    /** @param {string} src @param {string} filename @param {any} options */
    process(src, filename, options) {
      const r = original?.process
        ? original.process(src, filename, delegateOptions(options))
        : undefined
      return finish(normalize(r, src), filename)
    },
    /** @param {string} src @param {string} filename @param {any} options */
    async processAsync(src, filename, options) {
      const fn = original?.processAsync ?? original?.process
      const r = fn ? await fn.call(original, src, filename, delegateOptions(options)) : undefined
      return finish(normalize(r, src), filename)
    },
    /** @param {string} src @param {string} filename @param {any} options */
    getCacheKey(src, filename, options) {
      const base = original?.getCacheKey
        ? original.getCacheKey(src, filename, delegateOptions(options))
        : nodeCrypto.createHash('sha256').update(src).update(filename).digest('hex')
      return nodeCrypto
        .createHash('sha256')
        .update(String(base))
        .update(cfg.salt)
        .update(String(targeted(filename)))
        .digest('hex')
    },
  }
}

module.exports = { createTransformer }
