// @ts-check
'use strict'
// Injection de la sonde sous Mocha (stratégie retenue, R-01) : chargé par `--require` depuis un fichier
// généré HORS du projet. Enveloppe, au chargement CommonJS, les exports des modules `targets.include`
// (crochet sur `Module._extensions`) et branche la sonde sur les crochets racine de Mocha
// (`mochaHooks` : beforeEach / afterEach). Aucune logique au chargement : tout passe par `start`.

const path = require('path')

/**
 * @typedef {object} RegisterConfig
 * @property {string} projectRoot racine du projet
 * @property {string[]} include expressions régulières (sources) sur le chemin relatif au projet
 * @property {string[]} exclude
 */

/**
 * @typedef {object} MochaTest
 * @property {string} [file] chemin absolu du fichier de test
 * @property {() => string} fullTitle nom complet (suites + titre, séparés par une espace)
 */

/** Fonction « cible ? » d'un fichier, d'après `include` / `exclude`. @param {RegisterConfig} cfg */
function targeting(cfg) {
  const include = cfg.include.map((s) => new RegExp(s))
  const exclude = cfg.exclude.map((s) => new RegExp(s))
  /** @param {string} filename */
  const moduleIdOf = (filename) =>
    path.relative(cfg.projectRoot, filename).split(path.sep).join('/')
  /** @param {string} filename @returns {string | null} identifiant du module ciblé, sinon null */
  return (filename) => {
    const rel = moduleIdOf(filename)
    return !rel.startsWith('..') &&
      !rel.split('/').includes('node_modules') &&
      include.some((r) => r.test(rel)) &&
      !exclude.some((r) => r.test(rel))
      ? rel
      : null
  }
}

/**
 * Enveloppe les chargeurs CommonJS `.js` et `.cjs` : après l'exécution d'un module ciblé, ses exports
 * sont remplacés par ceux enveloppés par la sonde (comme le pied de module du transform Jest).
 * @param {any} Module constructeur `module` de Node @param {RegisterConfig} cfg
 * @param {any} g objet global portant l'état de la sonde
 */
function hookLoaders(Module, cfg, g) {
  const target = targeting(cfg)
  for (const ext of ['.js', '.cjs']) {
    const original = Module._extensions[ext]
    /** @param {any} module @param {string} filename */
    Module._extensions[ext] = function variaLoader(module, filename) {
      original.call(this, module, filename)
      const id = target(filename)
      const v = g.__varia
      if (id !== null && v && typeof v.wrapExports === 'function')
        module.exports = v.wrapExports(module.exports, id)
    }
  }
}

/**
 * Crochets racine de Mocha qui alimentent les crochets de la sonde (`install`) : le test courant est
 * lu sur `this.currentTest`, son nom complet est celui du rapport JSON (`fullTitle`).
 * @param {{ install: (hooks: any) => void }} probe @param {NodeJS.Process} proc
 */
function rootHooks(probe, proc) {
  /** @type {(() => void)[]} */
  const before = []
  /** @type {(() => void)[]} */
  const after = []
  /** @type {MochaTest | null} */
  let current = null
  probe.install({
    beforeEach: (/** @type {() => void} */ fn) => before.push(fn),
    afterEach: (/** @type {() => void} */ fn) => after.push(fn),
    getState: () => ({
      testPath: current?.file ?? '',
      currentTestName: current === null ? '' : current.fullTitle(),
    }),
    process: proc,
  })
  return {
    /** @this {{ currentTest?: MochaTest }} */
    beforeEach() {
      current = this.currentTest ?? null
      for (const fn of before) fn()
    },
    afterEach() {
      for (const fn of after) fn()
      current = null
    },
  }
}

/**
 * Démarrage dans le processus Mocha : crochet de chargement puis crochets racine.
 * @param {any} Module @param {{ install: (hooks: any) => void }} probe @param {RegisterConfig} cfg
 * @param {NodeJS.Process} proc @param {any} g
 */
function start(Module, probe, cfg, proc, g = globalThis) {
  hookLoaders(Module, cfg, g)
  return { mochaHooks: rootHooks(probe, proc) }
}

module.exports = { hookLoaders, rootHooks, start, targeting }
