// @ts-check
// Crochets de chargement ESM (`module.register`, R-01, ESM) : enregistrés par le fichier de setup
// généré par Varia (chargé par `--require` dans le processus Mocha), ils s'exécutent dans le fil des
// chargeurs de Node. Chaque module ESM `targets.include` est réécrit par la réécriture des exports de
// l'adapter Vitest (`rewriteExports`, même mécanisme, mêmes limites : appels internes non observés).
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { targeting } = /** @type {typeof import('./register.cjs')} */ (
  createRequire(import.meta.url)('./register.cjs')
)

/**
 * @typedef {object} HooksData
 * @property {string} projectRoot
 * @property {string[]} include
 * @property {string[]} exclude
 * @property {string} rewritePath chemin absolu de `rewrite.mjs` (adapter Vitest)
 */

/** @typedef {(code: string, file: string, id: string) => { code: string } | null} Rewrite */

/**
 * Réécriture d'un module chargé : `null` s'il n'est pas ciblé ou n'exporte aucune fonction. La
 * réécriture (TypeScript, coûteux à charger) n'est chargée qu'au premier module ESM ciblé : un projet
 * CommonJS n'en paie jamais le coût.
 * @param {HooksData} cfg @param {() => Promise<Rewrite>} loadRewrite
 * @returns {(url: string, source: string) => Promise<string | null>}
 */
export function makeRewriter(cfg, loadRewrite) {
  const target = targeting(cfg)
  /** @type {Promise<Rewrite> | null} */
  let rewrite = null
  return async (url, source) => {
    if (!url.startsWith('file:')) return null
    const file = fileURLToPath(url)
    const id = target(file)
    if (id === null) return null
    rewrite ??= loadRewrite()
    const out = (await rewrite)(source, file, id)
    return out === null ? null : out.code
  }
}

/** Charge `rewriteExports` depuis son fichier. @param {string} file @returns {Promise<Rewrite>} */
export async function importRewrite(file) {
  const mod = /** @type {{ rewriteExports: Rewrite }} */ (await import(pathToFileURL(file).href))
  return mod.rewriteExports
}

/** @type {((url: string, source: string) => Promise<string | null>) | null} */
let rewriter = null

/** Appelé une fois par Node avec les données de `register`. @param {HooksData} data */
export function initialize(data) {
  rewriter = makeRewriter(data, () => importRewrite(data.rewritePath))
}

/**
 * Crochet `load` : délègue, puis réécrit la source des seuls modules ESM ciblés.
 * @param {string} url @param {any} context
 * @param {(url: string, context: any) => Promise<{ format?: string | null, source?: unknown }>} next
 */
export async function load(url, context, next) {
  const r = await next(url, context)
  if (rewriter === null || r.format !== 'module' || r.source === undefined || r.source === null)
    return r
  const source =
    typeof r.source === 'string'
      ? r.source
      : Buffer.from(/** @type {Uint8Array} */ (r.source)).toString('utf8')
  const code = await rewriter(url, source)
  return code === null ? r : { ...r, source: code }
}
