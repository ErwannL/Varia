// Outils de mesure de couverture (politique J3, docs/notes/couverture.md) :
// - réduction et conversion de la couverture V8 brute des processus ENFANTS (NODE_V8_COVERAGE) ;
// - fusion avec la couverture du processus de test (même convertisseur, même source, structure vérifiée) ;
// - comptage EXACT (couverts / total) par fichier et par axe, depuis le JSON istanbul.
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** @typedef {{ start: { line: number, column: number }, end: { line: number, column: number } }} Loc */
/**
 * @typedef {object} FileCoverage entrée istanbul d'un fichier
 * @property {string} path
 * @property {Record<string, Loc>} statementMap
 * @property {Record<string, unknown>} fnMap
 * @property {Record<string, unknown>} branchMap
 * @property {Record<string, number>} s
 * @property {Record<string, number>} f
 * @property {Record<string, number[]>} b
 */
/** @typedef {Record<string, [number, number]>} Counts couverts / total par axe */
/** @typedef {{ pattern: string, statements: number, branches: number, functions: number, lines: number }} Threshold */
/** @typedef {{ thresholds: Threshold[], required: string[], excluded: Record<string, string> }} CoverageConfig */
/** @typedef {(file: string, functions: any[]) => Promise<FileCoverage>} Converter */

export const AXES = ['statements', 'branches', 'functions', 'lines']

/**
 * Fichier d'exécution de Varia (dossiers `runtime/` des paquets), exécuté tel quel par Node (URL `file:`) :
 * le seul code dont la couverture V8 brute est convertie par Varia (processus enfants et processus de
 * test). Le reste (TypeScript compilé, dépendances, code transformé) n'est jamais repris d'un enfant.
 */
/** @param {unknown} url @param {string} root */
export function isVariaFile(url, root) {
  if (typeof url !== 'string' || !url.startsWith('file://')) return false
  const file = fileURLToPath(url)
  const prefix = join(root, 'packages') + '/'
  return (
    file.startsWith(prefix) &&
    /\/runtime\/[^/]+$/.test(file) &&
    !file.includes('/node_modules/') &&
    !file.includes('/dist/') &&
    !file.includes('/test/')
  )
}

/** Réduit chaque dépôt brut `coverage-*.json` aux fichiers de Varia (`kept-*.json`), supprime le reste. */
/** @param {string} dir @param {string} root */
export function pruneChildCoverage(dir, root) {
  /** @type {string[]} */
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  let kept = 0
  for (const name of entries) {
    if (!name.startsWith('coverage-') || !name.endsWith('.json')) continue
    const path = join(dir, name)
    let data
    try {
      data = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      // Dépôt en cours d'écriture par un processus encore vivant : repris au passage suivant.
      continue
    }
    const result = (data.result ?? []).filter((/** @type {{ url: string }} */ r) =>
      isVariaFile(r.url, root),
    )
    rmSync(path, { force: true })
    if (result.length > 0) {
      writeFileSync(join(dir, `kept-${name.slice('coverage-'.length)}`), JSON.stringify({ result }))
      kept++
    }
  }
  return kept
}

/** Toutes les entrées brutes conservées, regroupées par fichier absolu. */
/** @param {string} dir @param {string} root @returns {Map<string, unknown[][]>} */
export function readChildCoverage(dir, root) {
  pruneChildCoverage(dir, root)
  /** @type {Map<string, unknown[][]>} */
  const byFile = new Map()
  /** @type {string[]} */
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return byFile
  }
  for (const name of names) {
    if (!name.startsWith('kept-')) continue
    const { result } = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    for (const r of result) {
      const file = fileURLToPath(r.url)
      const list = byFile.get(file) ?? []
      list.push(r.functions)
      byFile.set(file, list)
    }
  }
  return byFile
}

/**
 * Convertit la couverture V8 brute d'un fichier exécuté tel quel par Node (sans transformation, sans
 * enveloppe) avec le convertisseur AST utilisé par Vitest (`experimentalAstAwareRemapping`).
 */
/** @type {Converter} */
export async function convertRaw(file, functions) {
  const { default: astV8ToIstanbul } = await import('ast-v8-to-istanbul')
  const { parseAstAsync } = await import('vitest/node')
  const code = readFileSync(file, 'utf8')
  const ast = await parseAstAsync(code)
  const data = await astV8ToIstanbul({
    code,
    ast,
    coverage: { functions, url: pathToFileURL(file).href },
    wrapperLength: 0,
  })
  return data[file]
}

const sameShape = (/** @type {FileCoverage} */ a, /** @type {FileCoverage} */ b) =>
  JSON.stringify([a.statementMap, a.fnMap, a.branchMap]) ===
  JSON.stringify([b.statementMap, b.fnMap, b.branchMap])

/** Additionne les compteurs de `b` dans `a` (structures identiques exigées, sinon erreur). */
/** @param {FileCoverage} a @param {FileCoverage} b */
export function addCounts(a, b) {
  if (!sameShape(a, b))
    throw new Error(`structures de couverture différentes pour ${a.path} : fusion refusée`)
  for (const k of Object.keys(a.s)) a.s[k] = Number(a.s[k]) + Number(b.s[k])
  for (const k of Object.keys(a.f)) a.f[k] = Number(a.f[k]) + Number(b.f[k])
  for (const k of Object.keys(a.b)) {
    const other = /** @type {number[]} */ (b.b[k])
    a.b[k] = /** @type {number[]} */ (a.b[k]).map((n, i) => n + Number(other[i]))
  }
  return a
}

/** Aucun compteur non nul : l'entrée ne décrit qu'un fichier jamais exécuté. */
/** @param {FileCoverage} fc */
export function neverExecuted(fc) {
  return (
    Object.values(fc.s).every((n) => n === 0) &&
    Object.values(fc.f).every((n) => n === 0) &&
    Object.values(fc.b).every((xs) => xs.every((n) => n === 0))
  )
}

/** Fusionne la couverture des enfants dans la carte istanbul du processus de test (en place). */
/** @param {Record<string, FileCoverage>} map @param {string} dir @param {string} root @param {Converter} convert */
export async function mergeChildren(map, dir, root, convert = convertRaw) {
  /** @type {string[]} */
  const merged = []
  for (const [file, runs] of readChildCoverage(dir, root)) {
    /** @type {FileCoverage | null} */
    let acc = null
    for (const functions of runs) {
      const data = await convert(file, functions)
      acc = acc === null ? data : addCounts(acc, data)
    }
    // L'entrée de Vitest pour un fichier d'exécution est construite sur la source transformée par Vite
    // (positions fausses) : elle est REMPLACÉE par la conversion de la couverture brute.
    map[file] = /** @type {FileCoverage} */ (acc)
    merged.push(file)
  }
  // Un fichier d'exécution exécuté (compteurs de Vitest non nuls) sans couverture brute a été chargé
  // autrement (par Vite) : sa mesure serait fausse.
  for (const [file, fc] of Object.entries(map)) {
    if (!merged.includes(file) && isVariaFile(pathToFileURL(file).href, root) && !neverExecuted(fc))
      throw new Error(`${file} : couverture brute absente, mesure non fiable`)
  }
  return merged.sort()
}

/** Compte exact `[couverts, total]` par axe d'une entrée istanbul (lignes : règle d'istanbul). */
/** @param {FileCoverage} fc @returns {Counts} */
export function exactCounts(fc) {
  const s = Object.values(fc.s)
  const f = Object.values(fc.f)
  const b = Object.values(fc.b).flat()
  /** @type {Map<number, number>} */
  const lines = new Map()
  for (const [k, loc] of Object.entries(fc.statementMap)) {
    const line = loc.start.line
    lines.set(line, Math.max(lines.get(line) ?? 0, Number(fc.s[k])))
  }
  const l = [...lines.values()]
  /** @param {number[]} xs @returns {[number, number]} */
  const pair = (xs) => [xs.filter((n) => n > 0).length, xs.length]
  return { statements: pair(s), branches: pair(b), functions: pair(f), lines: pair(l) }
}

/** Glob minimal (`**` : tout, `*` : un segment) en expression régulière ancrée. */
/** @param {string} glob */
export function globToRegExp(glob) {
  const body = glob
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*')
  return new RegExp(`^${body}$`)
}

/** Fichier source d'un paquet (code livré), hors tests, déclarations et code compilé. */
/** @param {string} file */
export function isPackageSource(file) {
  return (
    file.startsWith('packages/') &&
    /\.(?:[cm]?[jt]s|tsx)$/.test(file) &&
    !file.endsWith('.d.ts') &&
    !/(?:^|\/)(?:test|node_modules|dist)\//.test(file)
  )
}

/**
 * Juge la couverture exacte. `exact` : { fichier: { axe: [couverts, total] } } ; `cfg` : contenu de
 * coverage-thresholds.json ; `sources` : fichiers suivis du dépôt. Renvoie la liste des échecs.
 */
/** @param {Record<string, Counts>} exact @param {CoverageConfig} cfg @param {string[]} sources */
export function evaluateCoverage(exact, cfg, sources) {
  /** @type {string[]} */
  const failures = []
  const rules = cfg.thresholds.map((t) => ({ t, re: globToRegExp(t.pattern) }))
  for (const [file, counts] of Object.entries(exact)) {
    const rule = rules.find((t) => t.re.test(file))
    if (rule === undefined) {
      failures.push(`${file} : aucun seuil ne s'applique`)
      continue
    }
    for (const a of AXES) {
      const [covered, total] = counts[a] ?? [0, 0]
      const min = rule.t[/** @type {'statements'} */ (a)]
      // Exact : couverts × 100 ≥ seuil × total (jamais le pourcentage arrondi).
      if (covered * 100 < min * total)
        failures.push(`${file} : ${a} ${covered}/${total} sous le seuil ${min} %`)
    }
  }
  for (const file of cfg.required) {
    const c = exact[file]
    if (c === undefined || c['statements']?.[0] === 0)
      failures.push(`${file} : fichier d'exécution non mesuré (0 instruction couverte)`)
  }
  for (const file of sources.filter(isPackageSource)) {
    if (exact[file] === undefined && cfg.excluded[file] === undefined)
      failures.push(`${file} : ni mesuré ni exclu explicitement (coverage-thresholds.json)`)
  }
  for (const [file, reason] of Object.entries(cfg.excluded)) {
    if (typeof reason !== 'string' || reason.trim() === '')
      failures.push(`${file} : exclusion sans raison`)
  }
  return failures
}
