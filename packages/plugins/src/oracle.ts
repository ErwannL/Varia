import type { Classification, ObservedCall, PlannedMutation } from '@varia/core'
import { RULE_STATUSES, type OracleRuleInput, type RuleStatus } from './contracts.js'
import type { AppliedVerdict } from './session.js'

/** Sous-types de processus : jamais remis en cause par une règle externe (signal de Varia). */
const PROCESS_SUBTYPES = ['RESOURCE_LIMIT', 'PROCESS_EXIT', 'UNHANDLED_REJECTION']

/**
 * Entrée d'une règle d'oracle, ou `null` si le résultat n'est pas un comportement observé de la
 * cible (infra, délai, mutation non appliquée, signal de processus) : une règle ne juge que la cible.
 */
export function ruleInputOf(
  m: PlannedMutation,
  c: Classification,
  call: ObservedCall | undefined,
): OracleRuleInput | null {
  if (call === undefined || !(RULE_STATUSES as readonly string[]).includes(c.status)) return null
  if (c.subtype !== undefined && PROCESS_SUBTYPES.includes(c.subtype)) return null
  return {
    mutation: {
      id: m.id,
      target: `${m.module}#${m.export}`,
      path: m.pathStr,
      strategy: m.strategy,
      op: m.op,
      original: m.original,
      value: m.value,
    },
    classification: {
      status: c.status as RuleStatus,
      subtype: c.subtype ?? null,
      reason: c.reason ?? null,
    },
    outcome: {
      kind: call.outcome.kind,
      value: call.outcome.value ?? null,
      error: call.outcome.error ?? null,
    },
    testStatus: c.testStatus,
  }
}

/**
 * Applique le verdict d'une règle : statut remplacé, raison `RULE:<plugin/id>:<code>` (traçable),
 * sous-type et chemin d'écho retirés ; même statut ⇒ classification inchangée.
 */
export function withVerdict(c: Classification, v: AppliedVerdict): Classification {
  if (v.status === c.status) return c
  const out: Classification = { ...c, status: v.status, reason: `RULE:${v.rule}:${v.reason}` }
  delete out.subtype
  delete out.echoPath
  return out
}
