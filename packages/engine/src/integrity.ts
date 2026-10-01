import { diffSnapshots, gitSnapshot, manifestSnapshot, type Snapshot } from '@varia/core'
import { execFileSync } from 'node:child_process'
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

/** Instantané du projet (CDC §5) : git si disponible (sauf `watch_ignored`), sinon manifeste. */
export function snapshotProject(
  root: string,
  o: { watchIgnored: boolean; ignore: string[] },
): Snapshot {
  return insideGit(root) && !o.watchIgnored ? gitSnapshot(root) : manifestSnapshot(root, o.ignore)
}

/** Toute différence attribuable au run ⇒ `PROJECT_MUTATED` (exit 4), avec la liste des fichiers. */
export function assertUnchanged(before: Snapshot, after: Snapshot): void {
  const changed = diffSnapshots(before, after)
  if (changed.length > 0)
    throw new VariaError('PROJECT_MUTATED', 'le projet cible a été modifié pendant le run', changed)
}
