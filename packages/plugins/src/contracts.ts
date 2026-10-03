// Contrats PUBLICS des extensions de Varia (CDC §39, docs/extensions.md). Stables pour une même
// `apiVersion` : un changement incompatible incrémente PLUGIN_API_VERSION.
import type { InputDescriptor } from '@varia/core'
import type { Json, SerializedError } from '@varia/probe-protocol'

/** Version du contrat d'extension acceptée par cette version de Varia. */
export const PLUGIN_API_VERSION = 1

/** Plafonds durs transmis à une stratégie (configuration bornée par les limites dures, §32-5). */
export interface StrategyLimits {
  stringLength: number
  arrayLength: number
  objectDepth: number
}

/** Contexte d'une génération : plafonds et générateur à graine (mulberry32) — seul aléa permis. */
export interface StrategyContext {
  limits: StrategyLimits
  /** Nombre dans [0, 1[ : graine dérivée de la graine du run, du call site, du chemin et de l'id. */
  random: () => number
}

/** Valeur proposée : `set` (défaut) remplace la valeur, `delete` supprime la propriété. */
export interface ExternalCandidate {
  op?: 'set' | 'delete'
  /** Valeur au format étiqueté du protocole (JSON pur ; `{ $t: 'undefined' }`, etc.). */
  value?: Json
}

/**
 * Stratégie de mutation externe. `supports` et `generate` sont SYNCHRONES, déterministes (même
 * entrée, même graine ⇒ même sortie, vérifié par Varia) et n'utilisent jamais `Math.random`.
 */
export interface MutationStrategy {
  id: string
  supports(input: InputDescriptor): boolean
  generate(input: InputDescriptor, ctx: StrategyContext): ExternalCandidate[]
}

/** Détecteur de format : reconnaît une chaîne et propose des variantes invalides (déterministes). */
export interface FormatDetector {
  id: string
  detect(value: string): boolean
  invalidValues(value: string): string[]
}

/** Statuts qu'une règle d'oracle peut rendre (comportements de la cible seulement, jamais l'infra). */
export const RULE_STATUSES = ['HANDLED', 'UNEXPECTED_FAILURE', 'CRASH', 'PASSED'] as const
export type RuleStatus = (typeof RULE_STATUSES)[number]

/** Ce qu'une règle d'oracle reçoit (valeurs déjà masquées par la sonde). */
export interface OracleRuleInput {
  mutation: {
    id: string
    target: string
    path: string
    strategy: string
    op: 'set' | 'delete'
    original: Json
    value: Json
  }
  /** Verdict de l'oracle intégré, avant la règle. */
  classification: {
    status: RuleStatus
    subtype: string | null
    reason: string | null
  }
  /** Issue de l'appel muté : `return` (valeur), `throw` / `reject` (erreur sérialisée). */
  outcome: { kind: string; value: Json | null; error: SerializedError | null }
  testStatus: string | null
}

/** Verdict d'une règle : `null` = sans avis ; `reason` est un code (`[A-Z0-9_]+`). */
export interface OracleVerdict {
  status: RuleStatus
  reason: string
}

export interface OracleRule {
  id: string
  evaluate(input: OracleRuleInput): OracleVerdict | null
}

/** Rapporteur : reçoit le rapport JSON (schéma publié, déjà masqué) et rend un texte. */
export interface Reporter {
  id: string
  /** Extension du fichier produit (`csv`, `txt`…), lettres minuscules et chiffres. */
  extension: string
  render(report: Readonly<Record<string, unknown>>): string
}

/** Module d'extension (export par défaut d'un fichier local ou d'un paquet installé). */
export interface VariaPlugin {
  apiVersion: number
  /** Espace de noms des identifiants : `<name>/<id>` (minuscules, chiffres, tirets). */
  name: string
  strategies?: MutationStrategy[]
  oracleRules?: OracleRule[]
  reporters?: Reporter[]
  formatDetectors?: FormatDetector[]
}

/** Aide au typage d'un module d'extension (identité). */
export function definePlugin(plugin: VariaPlugin): VariaPlugin {
  return plugin
}
