/** États d'issues d'un run par rapport au run de référence précédent (CDC §20.4). */
export type IssueState =
  | 'NEW'
  | 'UNCHANGED'
  | 'FIXED'
  | 'REGRESSION'
  | 'IMPROVED'
  | 'WORSENED'
  | 'UNKNOWN'

export interface IssueCount {
  id: string
  target: string
  count: number
  /** Mutations qui produisaient l'issue (référence) : une issue n'est FIXED que si on les a rejouées. */
  mutationIds?: string[]
}

export interface StateInput {
  current: IssueCount[]
  /** Issues présentes (count > 0) dans le run de référence ; `null` s'il n'existe pas. */
  previous: IssueCount[] | null
  /** Empreintes déjà vues un jour dans ce projet (hors run courant). */
  everSeen: Set<string>
  /** Targets effectivement rejouées dans le run courant. */
  executedTargets: Set<string>
  /** Mutations effectivement exécutées dans le run courant. */
  executedMutations?: Set<string>
  /** Run courant partiel (incrémental, budget, interruption) : périmètre réduit. */
  partial?: boolean
}

/**
 * - présente maintenant : NEW (jamais vue), REGRESSION (vue jadis, absente du run de référence),
 *   UNCHANGED / IMPROVED / WORSENED (comparaison du nombre de mutations) ;
 * - absente maintenant mais présente avant : FIXED si une de ses mutations a été rejouée sans la
 *   reproduire, ou (run COMPLET seulement) si sa target a été rejouée ; sinon UNKNOWN — un run partiel
 *   ne conclut jamais FIXED hors de ce qu'il a réellement exécuté (C-02).
 */
export function issueStates(i: StateInput): {
  present: Map<string, IssueState>
  absent: { issueId: string; state: IssueState }[]
} {
  const prev = new Map((i.previous ?? []).map((p) => [p.id, p]))
  const present = new Map<string, IssueState>()
  for (const c of i.current) {
    const p = prev.get(c.id)
    if (p === undefined) present.set(c.id, i.everSeen.has(c.id) ? 'REGRESSION' : 'NEW')
    else
      present.set(
        c.id,
        c.count === p.count ? 'UNCHANGED' : c.count < p.count ? 'IMPROVED' : 'WORSENED',
      )
  }
  const currentIds = new Set(i.current.map((c) => c.id))
  const absent = [...prev.values()]
    .filter((p) => !currentIds.has(p.id))
    .map((p) => {
      const replayed = (p.mutationIds ?? []).some((id) => i.executedMutations?.has(id) === true)
      const fixed = replayed || (i.partial !== true && i.executedTargets.has(p.target))
      return { issueId: p.id, state: (fixed ? 'FIXED' : 'UNKNOWN') as IssueState }
    })
  return { present, absent }
}

export interface RunDiff {
  added: string[]
  removed: string[]
  changed: { id: string; before: number; after: number }[]
  unchanged: string[]
}

/** Comparaison de deux runs (`varia compare a b`) par empreinte d'issue. */
export function diffIssues(a: IssueCount[], b: IssueCount[]): RunDiff {
  const ma = new Map(a.map((x) => [x.id, x.count]))
  const mb = new Map(b.map((x) => [x.id, x.count]))
  const sort = (xs: string[]) => [...xs].sort()
  return {
    added: sort(b.filter((x) => !ma.has(x.id)).map((x) => x.id)),
    removed: sort(a.filter((x) => !mb.has(x.id)).map((x) => x.id)),
    changed: b
      .filter((x) => ma.has(x.id) && ma.get(x.id) !== x.count)
      .map((x) => ({ id: x.id, before: ma.get(x.id) ?? 0, after: x.count }))
      .sort((x, y) => (x.id < y.id ? -1 : 1)),
    unchanged: sort(b.filter((x) => ma.get(x.id) === x.count).map((x) => x.id)),
  }
}
