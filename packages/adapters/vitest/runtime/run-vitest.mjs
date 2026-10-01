// @ts-check
// Lanceur Vitest de Varia : utilise l'API Node de la copie de Vitest DU PROJET pour injecter le plugin,
// le cache propre au run et le fichier de setup, sans aucun fichier de configuration dans le projet.
// Usage : node run-vitest.mjs <fichier-de-paramètres.json>
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { variaPlugin } from './plugin.mjs'

const params = JSON.parse(readFileSync(String(process.argv[2]), 'utf8'))
const req = createRequire(path.join(params.root, 'package.json'))
const pkgPath = req.resolve('vitest/package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
/** Résout une entrée `exports` (chaîne ou conditions imbriquées import/default). @param {unknown} e @returns {string} */
const pick = (e) =>
  typeof e === 'string' ? e : pick(/** @type {any} */ (e).import ?? /** @type {any} */ (e).default)
const nodeEntry = pick(pkg.exports['./node'])
const { startVitest } = await import(
  pathToFileURL(path.join(path.dirname(pkgPath), nodeEntry)).href
)
const vitest = await startVitest(
  'test',
  params.files,
  {
    root: params.root,
    ...(params.configFile ? { config: params.configFile } : {}),
    run: true,
    watch: false,
    reporters: [['json', {}]],
    ...(params.testNamePattern ? { testNamePattern: params.testNamePattern } : {}),
    pool: 'forks',
    fileParallelism: false,
    coverage: { enabled: false },
    passWithNoTests: true,
  },
  {
    plugins: [variaPlugin({ root: params.root, include: params.include, exclude: params.exclude })],
    cacheDir: params.cacheDir,
    test: { setupFiles: [params.setupFile] },
  },
)
await vitest?.close()
process.exit(process.exitCode ?? 0)
