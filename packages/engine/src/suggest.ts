import type { EngineContext } from './context.js'

export interface OracleSuggestion {
  /** Nom d'erreur jamais classé (ni handled_errors, ni crash_errors) : `UNEXPECTED_FAILURE`. */
  errorName: string
  count: number
  mutationIds: string[]
  /** Un message d'exemple (déjà normalisé et redigé à la source). */
  example: string
}

/**
 * `varia oracle suggest` (CDC §18.7) : les `UNEXPECTED_FAILURE` du dernier run, regroupées par nom
 * d'erreur (ordre : plus fréquentes d'abord). L'utilisateur décide HANDLED ou CRASH ; rien n'est
 * deviné ni écrit ici.
 */
export function oracleSuggestions(ctx: EngineContext): {
  runId: string | null
  items: OracleSuggestion[]
} {
  const run = ctx.reader.latestRun(ctx.projectId, ['COMPLETED', 'ABORTED'])
  if (run === null) return { runId: null, items: [] }
  const byName = new Map<string, OracleSuggestion>()
  for (const r of ctx.reader.results(run.id)) {
    if (r.status !== 'UNEXPECTED_FAILURE') continue
    const e = (r.error ?? {}) as { name?: string; message?: string }
    const name = e.name ?? ''
    if (name === '') continue
    const s = byName.get(name) ?? {
      errorName: name,
      count: 0,
      mutationIds: [],
      example: e.message ?? '',
    }
    s.count++
    s.mutationIds.push(r.mutationId)
    byName.set(name, s)
  }
  return {
    runId: run.id,
    items: [...byName.values()].sort(
      (a, b) => b.count - a.count || (a.errorName < b.errorName ? -1 : 1),
    ),
  }
}
