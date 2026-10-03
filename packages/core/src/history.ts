import type { SecondaryFingerprint } from './issues.js'

/** États d'issues d'un run par rapport au run de référence précédent (CDC §20.4). */
export type IssueState =
  | 'NEW'
  | 'UNCHANGED'
  | 'FIXED'
  | 'REGRESSION'
  | 'IMPROVED'
  | 'WORSENED'
  | 'UNKNOWN'
  /** Plusieurs issues de référence plausibles (CDC §20.3) : aucune fusion automatique. */
  | 'AMBIGUOUS_MATCH'

/**
 * Seuil de rapprochement par empreinte secondaire (CDC §20.2). Score = ½ × similarité de pile
 * (Jaccard des fichiers du projet) + ½ × (même hash de la ligne de code), après un filtre strict
 * (même nature d'issue, même module de target). 0,75 exige le même extrait de code ET au moins la
 * moitié des fichiers de pile en commun : une pile seule ou un extrait seul ne suffit jamais.
 */
export const MATCH_THRESHOLD = 0.75

/** Score de rapprochement de deux issues (0 si le filtre strict échoue ou si l'extrait manque). */
export function matchScore(
  a: { kind?: string; secondary?: SecondaryFingerprint | null },
  b: { kind?: string; secondary?: SecondaryFingerprint | null },
): number {
  const x = a.secondary
  const y = b.secondary
  if (x == null || y == null || a.kind !== b.kind || x.module !== y.module) return 0
  const union = new Set([...x.stackFiles, ...y.stackFiles])
  const common = x.stackFiles.filter((f) => y.stackFiles.includes(f)).length
  const stack = union.size === 0 ? 0 : common / union.size
  const code = x.codeHash !== null && x.codeHash === y.codeHash ? 1 : 0
  return 0.5 * stack + 0.5 * code
}

export interface IssueCount {
  id: string
  target: string
  count: number
  /** Mutations qui produisaient l'issue (référence) : une issue n'est FIXED que si on les a rejouées. */
  mutationIds?: string[]
  /** Nature et empreinte secondaire (CDC §20.2), pour le rapprochement. */
  kind?: string
  secondary?: SecondaryFingerprint | null
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
 *   ne conclut jamais FIXED hors de ce qu'il a réellement exécuté (C-02) ;
 * - empreinte primaire nouvelle, mais rapprochée (score ≥ `MATCH_THRESHOLD`) d'UNE SEULE issue de
 *   référence disparue, elle-même rapprochée de cette seule issue courante : continuation de
 *   l'issue (UNCHANGED / IMPROVED / WORSENED), consignée dans `matches` ; l'ancienne n'est pas FIXED ;
 * - plusieurs candidats d'un côté ou de l'autre : AMBIGUOUS_MATCH pour l'issue courante, UNKNOWN pour
 *   les candidats de référence — jamais de fusion automatique (CDC §20.3).
 */
export function issueStates(i: StateInput): {
  present: Map<string, IssueState>
  absent: { issueId: string; state: IssueState }[]
  /** Issue courante → issues de référence rapprochées (une seule, ou les candidats si ambigu). */
  matches: Map<string, string[]>
} {
  const prev = new Map((i.previous ?? []).map((p) => [p.id, p]))
  const currentIds = new Set(i.current.map((c) => c.id))
  const orphans = [...prev.values()].filter((p) => !currentIds.has(p.id))
  const candidates = new Map(
    i.current
      .filter((c) => !prev.has(c.id))
      .map((c) => [c.id, orphans.filter((p) => matchScore(c, p) >= MATCH_THRESHOLD)] as const)
      .filter(([, ps]) => ps.length > 0),
  )
  const claims = (id: string) =>
    [...candidates.values()].filter((ps) => ps.some((p) => p.id === id))
  const matches = new Map<string, string[]>()
  const present = new Map<string, IssueState>()
  const undecided = new Set<string>()
  const compare = (c: IssueCount, p: IssueCount): IssueState =>
    c.count === p.count ? 'UNCHANGED' : c.count < p.count ? 'IMPROVED' : 'WORSENED'
  for (const c of i.current) {
    const p = prev.get(c.id)
    const cands = candidates.get(c.id)
    if (p !== undefined) present.set(c.id, compare(c, p))
    else if (cands === undefined) present.set(c.id, i.everSeen.has(c.id) ? 'REGRESSION' : 'NEW')
    else {
      matches.set(
        c.id,
        cands.map((x) => x.id),
      )
      const only = cands[0] as IssueCount
      if (cands.length === 1 && claims(only.id).length === 1) present.set(c.id, compare(c, only))
      else {
        present.set(c.id, 'AMBIGUOUS_MATCH')
        for (const x of cands) undecided.add(x.id)
      }
    }
  }
  const continued = new Set([...matches.values()].flat().filter((id) => !undecided.has(id)))
  const absent = orphans
    .filter((p) => !continued.has(p.id))
    .map((p) => {
      const replayed = (p.mutationIds ?? []).some((id) => i.executedMutations?.has(id) === true)
      const fixed = replayed || (i.partial !== true && i.executedTargets.has(p.target))
      const state: IssueState = undecided.has(p.id) ? 'UNKNOWN' : fixed ? 'FIXED' : 'UNKNOWN'
      return { issueId: p.id, state }
    })
  return { present, absent, matches }
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
      .flatMap((x) => {
        const before = ma.get(x.id)
        return before !== undefined && before !== x.count
          ? [{ id: x.id, before, after: x.count }]
          : []
      })
      .sort((x, y) => (x.id < y.id ? -1 : 1)),
    unchanged: sort(b.filter((x) => ma.get(x.id) === x.count).map((x) => x.id)),
  }
}
