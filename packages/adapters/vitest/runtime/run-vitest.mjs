// @ts-check
// Lanceur Vitest de Varia : utilise l'API Node de la copie de Vitest DU PROJET pour injecter le plugin,
// le cache propre au run et le fichier de setup, sans aucun fichier de configuration dans le projet.
// Usage : node run-vitest.mjs <fichier-de-paramètres.json>
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { variaPlugin } from './plugin.mjs'

/**
 * @typedef {object} RunParams
 * @property {string} root
 * @property {string[]} files
 * @property {string | null} configFile
 * @property {string} [testNamePattern]
 * @property {string} [coverageDir]
 * @property {string[]} [coverageInclude]
 * @property {string} setupFile
 * @property {string[]} include
 * @property {string[]} exclude
 * @property {string} cacheDir
 */

/** Résout une entrée `exports` (chaîne ou conditions imbriquées import/default). @param {unknown} e @returns {string} */
export const pick = (e) =>
  typeof e === 'string' ? e : pick(/** @type {any} */ (e).import ?? /** @type {any} */ (e).default)

/** Chemin du point d'entrée `vitest/node` de la copie de Vitest du projet. @param {string} root */
export function vitestNodeEntry(root) {
  const req = createRequire(path.join(root, 'package.json'))
  const pkgPath = req.resolve('vitest/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  return pathToFileURL(path.join(path.dirname(pkgPath), pick(pkg.exports['./node']))).href
}

/** Options de `startVitest` (CLI) et de Vite pour un run Varia. @param {RunParams} params */
export function vitestOptions(params) {
  return {
    cli: {
      root: params.root,
      // Sans config dans le projet : `false`, sinon Vitest remonterait jusqu'à une config PARENTE.
      config: params.configFile ? params.configFile : false,
      run: true,
      watch: false,
      reporters: [['json', {}]],
      ...(params.testNamePattern ? { testNamePattern: params.testNamePattern } : {}),
      pool: 'forks',
      fileParallelism: false,
      coverage: params.coverageDir
        ? {
            enabled: true,
            provider: 'v8',
            reporter: ['json-summary'],
            reportsDirectory: params.coverageDir,
            include: params.coverageInclude,
          }
        : { enabled: false },
      passWithNoTests: true,
      setupFiles: [params.setupFile],
    },
    vite: {
      plugins: [
        variaPlugin({ root: params.root, include: params.include, exclude: params.exclude }),
      ],
      cacheDir: params.cacheDir,
    },
  }
}

/**
 * Lance Vitest (le code de sortie est posé par Vitest sur `process.exitCode`).
 * @param {RunParams} params
 * @param {(url: string) => Promise<any>} load chargeur du module `vitest/node`
 */
export async function runVitest(params, load) {
  const { startVitest } = await load(vitestNodeEntry(params.root))
  const o = vitestOptions(params)
  const vitest = await startVitest('test', params.files, o.cli, o.vite)
  await vitest?.close()
}

// Point d'entrée (sans `await` de premier niveau : le module reste chargeable par `require`).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runVitest(
    JSON.parse(readFileSync(String(process.argv[2]), 'utf8')),
    (url) => import(url),
  ).then(() => process.exit(process.exitCode ?? 0))
}
