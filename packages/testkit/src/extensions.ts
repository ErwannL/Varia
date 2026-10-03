// Outils publics pour tester une extension comme Varia l'exécute (T-01) : même chargement, même
// thread, mêmes contrôles (apiVersion, Math.random, plafonds, double génération), mêmes erreurs.
import type { InputDescriptor, MutationCandidate } from '@varia/core'
import {
  loadPlugins,
  type LoadedPlugin,
  type OracleRuleInput,
  type PluginFailure,
  type PluginSession,
  type ReporterOutput,
  type StrategyLimits,
} from '@varia/plugins'
import { stableStringify } from '@varia/probe-runtime'

/** Plafonds par défaut de Varia (configuration `mutations.limits`). */
export const DEFAULT_LIMITS: StrategyLimits = {
  stringLength: 10_000,
  arrayLength: 1_000,
  objectDepth: 20,
}

export interface ExtensionOptions {
  /** Chemin du module d'extension (relatif à `baseDir`) ou nom de paquet installé. */
  plugin: string
  baseDir?: string
  timeoutMs?: number
}

/** Session d'une seule extension, fermée après `fn` (même erreur ⇒ même code qu'en run réel). */
export function withPlugin<T>(o: ExtensionOptions, fn: (s: PluginSession) => T): T {
  const dir = o.baseDir ?? process.cwd()
  const s = loadPlugins({
    specifiers: [o.plugin],
    baseDir: dir,
    root: dir,
    timeoutMs: o.timeoutMs ?? 5000,
  })
  try {
    return fn(s)
  } finally {
    s.close()
  }
}

export interface GenerateOptions extends ExtensionOptions {
  /** Identifiant complet de la stratégie ou du détecteur (`<plugin>/<id>`). */
  strategy: string
  inputs: InputDescriptor[]
  seed?: number
  limits?: StrategyLimits
}

export interface GenerateResult {
  /** Candidats par entrée (`callSiteId|pathStr`), après validation par Varia. */
  candidates: Map<string, MutationCandidate[]>
  failures: PluginFailure[]
  loaded: LoadedPlugin[]
}

/**
 * Génère avec une stratégie externe comme en plan : entrées mutables seulement (une valeur masquée
 * ne l'est pas), deux appels comparés, valeurs validées contre le contrat et les plafonds.
 */
export function generateWith(o: GenerateOptions): GenerateResult {
  const inputs = o.inputs.filter((i) => i.mutable)
  return withPlugin(o, (s) => ({
    candidates: s.generate(inputs, o.seed ?? 1, o.limits ?? DEFAULT_LIMITS, [o.strategy]),
    failures: s.failures,
    loaded: s.loaded,
  }))
}

/**
 * Vérification du déterminisme : deux sessions indépendantes (threads neufs), même graine ⇒ mêmes
 * candidats, et aucune erreur (dont `NON_DETERMINISTIC` et `MATH_RANDOM_FORBIDDEN`).
 */
export function checkDeterminism(o: GenerateOptions): {
  deterministic: boolean
  failures: PluginFailure[]
  candidates: Map<string, MutationCandidate[]>
} {
  const a = generateWith(o)
  const b = generateWith(o)
  const same = stableStringify([...a.candidates]) === stableStringify([...b.candidates])
  const failures = [...a.failures, ...b.failures]
  return { deterministic: same && failures.length === 0, failures, candidates: a.candidates }
}

/** Lève une erreur explicite si la stratégie n'est pas déterministe ; rend ses candidats. */
export function assertDeterministic(o: GenerateOptions): Map<string, MutationCandidate[]> {
  const r = checkDeterminism(o)
  if (!r.deterministic)
    throw new Error(
      `stratégie non déterministe ou en erreur : ${o.strategy} ${JSON.stringify(r.failures)}`,
    )
  return r.candidates
}

/** Évalue les règles d'oracle d'une extension sur une entrée (voir `ruleInputOf`). */
export function evaluateRules(o: ExtensionOptions & { input: OracleRuleInput }) {
  return withPlugin(o, (s) => ({ verdict: s.applyRules(o.input), failures: s.failures }))
}

/** Rendu des rapporteurs d'une extension sur un rapport JSON (déjà masqué). */
export function renderWith(o: ExtensionOptions & { report: Readonly<Record<string, unknown>> }): {
  outputs: ReporterOutput[]
  failures: PluginFailure[]
} {
  return withPlugin(o, (s) => ({ outputs: s.render(o.report), failures: s.failures }))
}
