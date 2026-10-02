import type { Json } from '@varia/probe-protocol'
import { sha256, stableStringify, typeOfSerialized } from '@varia/probe-runtime'
import type { InputDescriptor } from './catalog.js'
import { mulberry32, shuffle } from './rng.js'
import {
  candidatesFor,
  DEFAULT_CONTEXT,
  type MutationCandidate,
  type BoundsProvenance,
  type MutationContext,
} from './strategies/index.js'

export const PLAN_SCHEMA_VERSION = 1

export interface PlannedMutation {
  id: string
  callSiteId: string
  testId: string
  testFile: string
  testName: string
  module: string
  export: string
  depth: number
  sequence: number
  argsFingerprint: string
  path: string[]
  pathStr: string
  strategy: string
  op: 'set' | 'delete'
  original: Json
  value: Json
  originalType: string
  mutatedType: string
  /** Stratégie `boundary` : provenance de la borne (déclarée, observée, universelle, CDC §12.3). */
  provenance?: BoundsProvenance
}

export interface Plan {
  schemaVersion: number
  variaVersion: string
  seed: number
  /** Commit git du projet (`null` hors dépôt, CDC §14.1). L'empreinte d'environnement, qui varie
   * d'une machine à l'autre, n'est PAS dans le plan (déterminisme, DECISIONS D-027). */
  gitCommit: string | null
  /** Empreinte de la configuration résolue (CDC §14.1). */
  configHash: string
  /** Mutations possibles avant budget et mutations retenues (échantillonnage annoncé, §14.4). */
  possible: number
  mutations: PlannedMutation[]
}

export interface PlanOptions {
  seed: number
  perInput: number
  strategies: string[]
  variaVersion: string
  configHash: string
  gitCommit?: string | null
  tests: Map<string, { file: string; name: string }>
  /** Plafond par target `module#export`. */
  perTarget?: Record<string, number>
  /** Plafond global (`limits.total_mutations` / `--max-mutations`). */
  total?: number
  excludeTests?: Set<string>
  /** Valeurs déclarées par chemin `export#arg0.x` (stratégie `declared`). */
  extraValues?: Record<string, Json[]>
  /** Identifiants ayant donné un crash dans l'historique (priorité, §13.4-3). */
  crashHistory?: Set<string>
  context?: MutationContext
}

export function mutationId(
  callSiteId: string,
  pathStr: string,
  strategy: string,
  op: string,
  value: Json,
): string {
  return (
    'm_' +
    sha256([callSiteId, pathStr, strategy, op, stableStringify(value)].join('\u0000')).slice(0, 12)
  )
}

function candidatesForInput(input: InputDescriptor, o: PlanOptions): PlannedMutation[] {
  const seen = new Set<string>([stableStringify(input.original)])
  const candidates: MutationCandidate[] = []
  for (const declared of o.extraValues?.[`${input.export}#${input.pathStr}`] ?? []) {
    candidates.push({ strategy: 'declared', op: 'set', value: declared })
  }
  candidates.push(...candidatesFor(input, o.strategies, o.context ?? DEFAULT_CONTEXT))
  const test = o.tests.get(input.testId)
  return candidates
    .filter((c) => {
      const key = c.op === 'delete' ? '<delete>' : stableStringify(c.value)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((c) => ({
      id: mutationId(input.callSiteId, input.pathStr, c.strategy, c.op, c.value),
      callSiteId: input.callSiteId,
      testId: input.testId,
      testFile: test?.file ?? '',
      testName: test?.name ?? '',
      module: input.module,
      export: input.export,
      depth: input.depth,
      sequence: input.sequence,
      argsFingerprint: input.argsFingerprint,
      path: input.path,
      pathStr: input.pathStr,
      strategy: c.strategy,
      op: c.op,
      original: input.original,
      value: c.value,
      originalType: input.type,
      mutatedType: c.op === 'delete' ? 'undefined' : typeOfSerialized(c.value),
      ...(c.provenance !== undefined ? { provenance: c.provenance } : {}),
    }))
}

/**
 * Sélection par chemin (CDC §13.4) : (1) historique de crash, (2) une par stratégie, (3) diversité des
 * types mutés, (4) tirage reproductible (mulberry32 seulement, jamais d’aléa non graine).
 */
export function selectPerInput(
  all: PlannedMutation[],
  limit: number,
  next: () => number,
  crashHistory: Set<string> = new Set(),
): PlannedMutation[] {
  if (all.length <= limit) return all
  const chosen: PlannedMutation[] = []
  const take = (m: PlannedMutation) => {
    if (chosen.length < limit && !chosen.includes(m)) chosen.push(m)
  }
  all.filter((m) => crashHistory.has(m.id)).forEach(take)
  const strategies = new Set(chosen.map((m) => m.strategy))
  for (const m of all)
    if (!strategies.has(m.strategy)) {
      strategies.add(m.strategy)
      take(m)
    }
  const types = new Set(chosen.map((m) => m.mutatedType))
  for (const m of shuffle(all, next))
    if (!types.has(m.mutatedType)) {
      types.add(m.mutatedType)
      take(m)
    }
  for (const m of shuffle(all, next)) take(m)
  return chosen
}

export function generatePlan(catalog: InputDescriptor[], o: PlanOptions): Plan {
  const next = mulberry32(o.seed)
  const ordered = [...catalog]
    .filter((i) => i.mutable && !(o.excludeTests?.has(i.testId) ?? false))
    .sort((a, b) => (a.callSiteId + a.pathStr < b.callSiteId + b.pathStr ? -1 : 1))
  const perTargetCount = new Map<string, number>()
  let mutations: PlannedMutation[] = []
  let possible = 0
  for (const input of ordered) {
    const all = candidatesForInput(input, o)
    possible += all.length
    const target = `${input.module}#${input.export}`
    const cap = o.perTarget?.[target]
    const used = perTargetCount.get(target) ?? 0
    const remaining = cap === undefined ? o.perInput : Math.min(o.perInput, cap - used)
    if (remaining <= 0) continue
    const picked = selectPerInput(all, remaining, next, o.crashHistory)
    perTargetCount.set(target, used + picked.length)
    mutations.push(...picked)
  }
  if (o.total !== undefined && mutations.length > o.total)
    mutations = shuffle(mutations, next).slice(0, o.total)
  mutations.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    variaVersion: o.variaVersion,
    seed: o.seed,
    gitCommit: o.gitCommit ?? null,
    configHash: o.configHash,
    possible,
    mutations,
  }
}

/** Sérialisation canonique du plan : clés triées, indentation 2, LF final (CDC B). */
export function serializePlan(plan: Plan): string {
  return stableStringify(plan, 2) + '\n'
}
