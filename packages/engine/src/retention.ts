import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineContext } from './context.js'

/**
 * Rétention (CDC §24, B-03) : garde les `keep` runs les plus récents du projet (défaut
 * `storage.retention_runs`), supprime les autres et leurs plans ; issues et acceptations conservées.
 * Ce qui est purgé est journalisé (journal pino, événement `RUNS_PRUNED` sur `currentRunId`).
 */
export function pruneRuns(
  ctx: EngineContext,
  keep = ctx.config.parsed.storage.retention_runs,
  currentRunId?: string,
): string[] {
  const removed = ctx.writer.prune(ctx.projectId, keep)
  for (const id of removed) rmSync(join(ctx.dataDir, 'plans', `${id}.json`), { force: true })
  if (removed.length > 0) {
    ctx.log.info({ pruned: removed, keep }, 'runs purgés (rétention)')
    if (currentRunId !== undefined) ctx.writer.event(currentRunId, 'RUNS_PRUNED', { runs: removed })
  }
  return removed
}
