import type { Classification } from './oracle.js'

export interface Counts {
  mutations: number
  handled: number
  expected: number
  passed: number
  suspicious: number
  unexpected: number
  crashes: number
  timeouts: number
  skipped: number
  infra: number
  pending: number
}

/** Comptes bruts (CDC §22) ; `pending` = mutations planifiées sans résultat (run partiel, reprise). */
export function countResults(planned: number, results: Classification[]): Counts {
  const c: Counts = {
    mutations: planned,
    handled: 0,
    expected: 0,
    passed: 0,
    suspicious: 0,
    unexpected: 0,
    crashes: 0,
    timeouts: 0,
    skipped: 0,
    infra: 0,
    pending: planned - results.length,
  }
  for (const r of results) {
    if (r.status === 'HANDLED') c.handled++
    else if (r.status === 'EXPECTED_FAILURE') c.expected++
    else if (r.status === 'PASSED') {
      c.passed++
      if (r.subtype === 'SUSPICIOUS_ACCEPT') c.suspicious++
    } else if (r.status === 'UNEXPECTED_FAILURE') c.unexpected++
    else if (r.status === 'CRASH') c.crashes++
    else if (r.status === 'TIMEOUT') c.timeouts++
    else if (r.status === 'SKIPPED') c.skipped++
    else c.infra++
  }
  return c
}

/** Taux de résilience, secondaire (CDC §22) ; `null` si aucune mutation exécutable. */
export function resilienceRate(c: Counts): number | null {
  const executable = c.mutations - c.pending - c.skipped - c.infra
  if (executable <= 0) return null
  return (c.handled + c.expected + (c.passed - c.suspicious)) / executable
}
