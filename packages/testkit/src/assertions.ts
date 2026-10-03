// Assertions publiques sur les statuts (T-01) : indépendantes du lanceur de tests (lèvent une
// `AssertionError` de Node, reconnue par Jest, Vitest, Mocha, node:test…).
import type { Classification, Status } from '@varia/core'
import { AssertionError } from 'node:assert'

export interface StatusExpectation {
  subtype?: string | null
  reason?: string | null
}

/** Vérifie le statut (et, si donnés, le sous-type et la raison) d'un résultat classé. */
export function assertStatus(c: Classification, status: Status, o: StatusExpectation = {}): void {
  const actual = {
    status: c.status,
    ...('subtype' in o ? { subtype: c.subtype ?? null } : {}),
    ...('reason' in o ? { reason: c.reason ?? null } : {}),
  }
  const expected = { status, ...o }
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new AssertionError({
      message: `statut attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`,
      actual,
      expected,
      operator: 'assertStatus',
    })
}
