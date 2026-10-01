import type { Report } from './schema.js'

export interface CiPolicy {
  failOn: string[]
  failOnRegression: boolean
  /** Identifiants d'issues du run de référence (`fail_on_new_only_against`) ; `null` : toutes comptent. */
  reference: Set<string> | null
}

/** Statut de `ci.fail_on` correspondant au type d'une issue. */
export const STATUS_OF_KIND: Record<string, string> = {
  ERROR: 'CRASH',
  PROCESS_EXIT: 'CRASH',
  RESOURCE_LIMIT: 'CRASH',
  DEPENDENCY_ERROR: 'UNEXPECTED_FAILURE',
  UNEXPECTED: 'UNEXPECTED_FAILURE',
  TIMEOUT: 'TIMEOUT',
  SUSPICIOUS_ACCEPT: 'SUSPICIOUS_ACCEPT',
}

export interface CiVerdict {
  fail: boolean
  /** Codes : FAIL_ON:<statut>:<issue>, REGRESSION:<issue>. */
  reasons: string[]
}

/** Politique CI (CDC §28) : échec sur les statuts `fail_on`, sur régression, ou seulement sur les NOUVELLES issues. */
export function ciVerdict(r: Report, p: CiPolicy): CiVerdict {
  const reasons: string[] = []
  for (const i of r.issues) {
    if (i.state === 'ACCEPTED') continue
    if (p.reference !== null && p.reference.has(i.id)) continue
    const status = STATUS_OF_KIND[i.kind] ?? i.kind
    if (p.failOn.includes(status)) reasons.push(`FAIL_ON:${status}:${i.id}`)
    if (p.failOnRegression && (i.state === 'REGRESSION' || i.state === 'WORSENED'))
      reasons.push(`REGRESSION:${i.id}`)
  }
  return { fail: reasons.length > 0, reasons }
}

/** Annotations GitHub Actions (`::error file=…,line=…::…`). */
export function githubAnnotations(r: Report): string[] {
  return r.issues.map((i) => {
    const m = i.frame === null ? null : /\(([^():]+):(\d+)\)$/.exec(i.frame)
    const where = m ? ` file=${m[1] ?? ''},line=${m[2] ?? ''}` : ''
    const level = i.severity === 'CRITICAL' || i.severity === 'HIGH' ? 'error' : 'warning'
    const text = `${i.title} (${String(i.count)} mutations) — ${i.replay}`
      .replace(/%/g, '%25')
      .replace(/\r/g, '%0D')
      .replace(/\n/g, '%0A')
    return `::${level}${where.length > 0 ? where : ''} title=Varia ${i.kind}::${text}`.replace(
      `::${level} file`,
      `::${level} file`,
    )
  })
}
