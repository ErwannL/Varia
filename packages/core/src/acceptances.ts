/** Acceptations (CDC §21) : une mutation reconnue comme valeur autorisée par le domaine. */
export interface Acceptance {
  id: string
  source: 'file' | 'db'
  /** `export` ou `module#export`. */
  function: string
  path?: string | undefined
  strategy?: string | undefined
  reason: string
  owner?: string | undefined
  /** Date ISO `AAAA-MM-JJ` (incluse). */
  expires?: string | undefined
}

export type AcceptanceStatus = 'ACTIVE' | 'EXPIRED' | 'OBSOLETE'

export interface MutationKey {
  id: string
  module: string
  export: string
  pathStr: string
  strategy: string
}

export function acceptanceMatches(a: Acceptance, m: MutationKey): boolean {
  const fn = a.function === m.export || a.function === `${m.module}#${m.export}`
  return (
    fn &&
    (a.path === undefined || a.path === m.pathStr) &&
    (a.strategy === undefined || a.strategy === m.strategy)
  )
}

export interface AcceptanceEvaluation {
  /** Mutations couvertes par une acceptation ACTIVE. */
  accepted: Map<string, string>
  statuses: { acceptance: Acceptance; status: AcceptanceStatus; matched: number }[]
}

/**
 * Une acceptation expirée redevient visible (ne couvre plus rien) ; une acceptation qui ne correspond
 * à aucune mutation planifiée est signalée OBSOLETE. Rien n'est jamais caché silencieusement.
 */
export function evaluateAcceptances(
  list: Acceptance[],
  mutations: MutationKey[],
  today: string,
): AcceptanceEvaluation {
  const accepted = new Map<string, string>()
  const statuses = list.map((a) => {
    const matching = mutations.filter((m) => acceptanceMatches(a, m))
    const expired = a.expires !== undefined && a.expires < today
    if (!expired) for (const m of matching) if (!accepted.has(m.id)) accepted.set(m.id, a.id)
    const status: AcceptanceStatus = expired
      ? 'EXPIRED'
      : matching.length === 0
        ? 'OBSOLETE'
        : 'ACTIVE'
    return { acceptance: a, status, matched: matching.length }
  })
  return { accepted, statuses }
}
