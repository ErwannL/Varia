import { diffSnapshots, gitSnapshot, manifestSnapshot, type Snapshot } from '@varia/core'
import type { RunRecord } from '@varia/database'
import { execFileSync } from 'node:child_process'
import { isAbsolute, relative, sep } from 'node:path'
import type { EngineContext } from './context.js'
import { VariaError } from './errors.js'

function insideGit(root: string): boolean {
  try {
    return (
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === 'true'
    )
  } catch {
    return false
  }
}

export interface IntegrityOptions {
  watchIgnored: boolean
  /** Dossiers non surveillés, relatifs au projet (`ignore_for_integrity` + stockage de Varia). */
  ignore: string[]
}

/**
 * Options de surveillance d'un contexte : `integrity.*` de la configuration, plus le dossier de
 * données de Varia quand il est DANS le projet (`storage.location: project`, `--data-dir` interne) :
 * Varia y écrit pendant le run, ce n'est pas une modification du projet par la cible.
 */
export function integrityOptions(ctx: EngineContext): IntegrityOptions {
  const i = ctx.config.parsed.integrity
  const data = relative(ctx.root, ctx.dataDir).split(sep).join('/')
  const inside = data !== '' && !data.startsWith('..') && !isAbsolute(data)
  return {
    watchIgnored: i.watch_ignored,
    ignore: [...i.ignore_for_integrity, ...(inside ? [data] : [])],
  }
}

/** Instantané du projet (CDC §5) : git si disponible (sauf `watch_ignored`), sinon manifeste. */
export function snapshotProject(root: string, o: IntegrityOptions): Snapshot {
  return insideGit(root) && !o.watchIgnored
    ? gitSnapshot(root, o.ignore)
    : manifestSnapshot(root, o.ignore)
}

/**
 * Exécute une opération qui lance le projet (baseline, fuzz, rejeu, doctor) entre deux instantanés
 * (CDC §5). Si le projet a changé, le run concerné est d'abord MARQUÉ `PROJECT_MUTATED` (avec la liste
 * des fichiers : il ne servira jamais de référence de comparaison), puis l'erreur est levée — même si
 * l'opération elle-même a échoué (la modification du projet est l'erreur la plus grave).
 */
export async function guardProject<T>(
  ctx: EngineContext,
  runId: () => string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const o = integrityOptions(ctx)
  const before = snapshotProject(ctx.root, o)
  const outcome = await fn().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  )
  const changed = diffSnapshots(before, snapshotProject(ctx.root, o))
  if (changed.length > 0) {
    const id = runId()
    if (id !== null) {
      const info = (ctx.reader.getRun(id) as RunRecord).info
      ctx.writer.updateRun(id, {
        state: 'PROJECT_MUTATED',
        info: { ...info, projectMutated: changed },
      })
      ctx.writer.event(id, 'PROJECT_MUTATED', { files: changed })
    }
    throw new VariaError('PROJECT_MUTATED', 'le projet cible a été modifié pendant le run', changed)
  }
  if (!outcome.ok) throw outcome.error
  return outcome.value
}
