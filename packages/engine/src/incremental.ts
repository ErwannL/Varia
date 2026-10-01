import { execFileSync } from 'node:child_process'
import { relative, resolve, sep } from 'node:path'
import type { EngineContext } from './context.js'
import { VariaError } from './errors.js'

export interface ChangedScope {
  /** Fichiers modifiés relatifs au projet (séparateurs `/`), ou `null` si indéterminable. */
  files: string[] | null
  base: string
}

/**
 * Fichiers modifiés depuis `base` (CDC §29) : `git diff` + fichiers non suivis. `--changed` est une
 * OPTIMISATION, jamais une source de vérité : portée indéterminable ⇒ `null`.
 */
export function changedFiles(root: string, base = 'HEAD'): ChangedScope {
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  try {
    const top = git(['rev-parse', '--show-toplevel']).trim()
    const listed = [
      ...git(['diff', '--name-only', base, '--', '.']).split('\n'),
      ...git(['ls-files', '--others', '--exclude-standard', '--full-name', '--', '.']).split('\n'),
    ]
    const files = [
      ...new Set(
        listed.filter(Boolean).map((f) => relative(root, resolve(top, f)).split(sep).join('/')),
      ),
    ]
    return { files: files.filter((f) => !f.startsWith('..')).sort(), base }
  } catch {
    return { files: null, base }
  }
}

/**
 * Filtre incrémental : garde les call sites dont la TARGET est dans un module modifié, ou dont le
 * TEST est dans un fichier modifié. Les associations viennent des appels observés en baseline.
 * Portée indéterminable : `incremental.on_unknown` (`full` annoncé, ou arrêt).
 */
export function incrementalFilter(
  ctx: EngineContext,
  scope: ChangedScope,
): ((c: { module: string; testFile: string }) => boolean) | null {
  if (scope.files === null) {
    if (ctx.config.parsed.incremental.on_unknown === 'abort')
      throw new VariaError('INFRA_FAILURE', 'portée incrémentale indéterminable (git indisponible)')
    ctx.emit({ type: 'warning', message: 'INCREMENTAL_UNKNOWN_FULL' })
    return null
  }
  const changed = new Set(scope.files)
  return (c) => changed.has(c.module) || changed.has(c.testFile)
}
