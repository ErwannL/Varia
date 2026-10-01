import type { Json } from './events.js'
import type { InputDescriptor } from './catalog.js'
import { shuffle, mulberry32 } from './rng.js'
import { sha256, stableStringify, typeOfSerialized } from './serialize.js'
import { STRATEGIES, type MutationCandidate } from './strategies.js'

export const PLAN_SCHEMA_VERSION = 1
export const VARIA_VERSION = '0.0.1'

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
}

export interface Plan {
  schemaVersion: number
  variaVersion: string
  seed: number
  mutations: PlannedMutation[]
}

export interface PlanOptions {
  seed: number
  perInput: number
  strategies?: string[]
  /** Plafond par target `module#export` (ex. 3 pour `repeat` en J0). */
  perTarget?: Record<string, number>
  /** Tests exclus (FLAKY). */
  excludeTests?: Set<string>
  /** Valeurs supplémentaires déclarées par chemin `export#arg0.x` (stratégie `declared`). */
  extraValues?: Record<string, Json[]>
  /** testId → fichier et nom complet (pour la sélection du test au rejeu). */
  tests: Map<string, { file: string; name: string }>
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

function planFor(input: InputDescriptor, o: PlanOptions): PlannedMutation[] {
  const enabled = STRATEGIES.filter(
    (s) => o.strategies === undefined || o.strategies.includes(s.id),
  )
  const seen = new Set<string>([stableStringify(input.original)])
  const candidates: MutationCandidate[] = []
  for (const declared of o.extraValues?.[`${input.export}#${input.pathStr}`] ?? []) {
    candidates.push({ strategy: 'declared', op: 'set', value: declared })
  }
  for (const s of enabled) if (s.supports(input)) candidates.push(...s.generate(input))
  const unique = candidates.filter((c) => {
    const key = c.op === 'delete' ? '<delete>' : stableStringify(c.value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const toPlanned = (c: MutationCandidate): PlannedMutation => ({
    id: mutationId(input.callSiteId, input.pathStr, c.strategy, c.op, c.value),
    callSiteId: input.callSiteId,
    testId: input.testId,
    testFile: o.tests.get(input.testId)?.file ?? '',
    testName: o.tests.get(input.testId)?.name ?? '',
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
  })
  return unique.map(toPlanned)
}

/**
 * Sélection (CDC §13.4) : au moins une mutation par stratégie, puis tirage reproductible (mulberry32).
 * Le plan final est trié par identifiant.
 */
export function selectPerInput(
  all: PlannedMutation[],
  limit: number,
  next: () => number,
): PlannedMutation[] {
  if (all.length <= limit) return all
  const first = new Map<string, PlannedMutation>()
  for (const m of all) if (!first.has(m.strategy)) first.set(m.strategy, m)
  const chosen = [...first.values()].slice(0, limit)
  const rest = shuffle(
    all.filter((m) => !chosen.includes(m)),
    next,
  )
  return [...chosen, ...rest.slice(0, limit - chosen.length)]
}

export function generatePlan(catalog: InputDescriptor[], o: PlanOptions): Plan {
  const next = mulberry32(o.seed)
  const ordered = [...catalog]
    .filter((i) => i.mutable && !(o.excludeTests?.has(i.testId) ?? false))
    .sort((a, b) => (a.callSiteId + a.pathStr < b.callSiteId + b.pathStr ? -1 : 1))
  const perTargetCount = new Map<string, number>()
  const mutations: PlannedMutation[] = []
  for (const input of ordered) {
    const target = `${input.module}#${input.export}`
    const cap = o.perTarget?.[target]
    const used = perTargetCount.get(target) ?? 0
    const remaining = cap === undefined ? o.perInput : Math.min(o.perInput, cap - used)
    if (remaining <= 0) continue
    const picked = selectPerInput(planFor(input, o), remaining, next)
    perTargetCount.set(target, used + picked.length)
    mutations.push(...picked)
  }
  mutations.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    variaVersion: VARIA_VERSION,
    seed: o.seed,
    mutations,
  }
}

/** Sérialisation canonique du plan : clés triées, indentation 2, LF final (CDC B). */
export function serializePlan(plan: Plan): string {
  return stableStringify(plan, 2) + '\n'
}
