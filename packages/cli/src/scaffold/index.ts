// `varia scaffold` (T-02) : génère le squelette fonctionnel d'un adaptateur ou d'une extension.
// Déterministe (mêmes type et nom ⇒ mêmes fichiers, mêmes octets), sans réseau, et n'écrit que
// dans un dossier cible absent ou vide.
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { adapterFiles } from './adapter.js'
import { isValidName, namesOf } from './common.js'
import { pluginFiles } from './plugin.js'

export { isValidName, NAME_MAX } from './common.js'

export const SCAFFOLD_KINDS = ['adapter', 'strategy', 'rule', 'reporter'] as const
export type ScaffoldKind = (typeof SCAFFOLD_KINDS)[number]

export function isScaffoldKind(kind: string): kind is ScaffoldKind {
  return (SCAFFOLD_KINDS as readonly string[]).includes(kind)
}

/** Fichiers du squelette (chemin relatif POSIX → contenu), triés par chemin. */
export function scaffoldFiles(kind: ScaffoldKind, name: string): Record<string, string> {
  const n = namesOf(name)
  const files = kind === 'adapter' ? adapterFiles(n) : pluginFiles(kind, n)
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)))
}

export type ScaffoldRefusal = 'BAD_KIND' | 'BAD_NAME' | 'NOT_DIRECTORY' | 'NOT_EMPTY'

export type ScaffoldResult =
  | { ok: true; kind: ScaffoldKind; path: string; files: string[] }
  | { ok: false; reason: ScaffoldRefusal; path: string | null }

/** État du dossier cible : absent, vide, non vide ou n'est pas un dossier. */
function targetState(path: string): 'free' | 'NOT_DIRECTORY' | 'NOT_EMPTY' {
  let isDir: boolean
  try {
    isDir = statSync(path).isDirectory()
  } catch {
    return 'free'
  }
  if (!isDir) return 'NOT_DIRECTORY'
  return readdirSync(path).length === 0 ? 'free' : 'NOT_EMPTY'
}

/** Écrit le squelette dans `<dir>/<name>` ; refuse sans rien écrire si l'entrée est invalide. */
export function writeScaffold(kind: string, name: string, dir: string): ScaffoldResult {
  if (!isScaffoldKind(kind)) return { ok: false, reason: 'BAD_KIND', path: null }
  if (!isValidName(name)) return { ok: false, reason: 'BAD_NAME', path: null }
  const path = join(dir, name)
  const state = targetState(path)
  if (state !== 'free') return { ok: false, reason: state, path }
  const files = scaffoldFiles(kind, name)
  for (const [rel, content] of Object.entries(files)) {
    const file = join(path, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  return { ok: true, kind, path, files: Object.keys(files) }
}
