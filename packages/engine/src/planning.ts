import {
  generatePlan,
  globToRegExpSource,
  serializePlan,
  type ObservedCall,
  type Plan,
} from '@varia/core'
import { STRATEGY_NAMES } from '@varia/config'
import type { RunRecord } from '@varia/database'
import type { Json } from '@varia/probe-protocol'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { catalogFromCalls } from './baseline.js'
import { changedFiles, incrementalFilter } from './incremental.js'
import type { EngineContext } from './context.js'
import { VariaError } from './errors.js'
import { VARIA_VERSION } from './version.js'
import { announceNew, pluginSession, recordPlugins } from './plugins.js'

export interface PlanSummary {
  runId: string
  seed: number
  possible: number
  planned: number
  sampled: boolean
  estimateMs: number
  warn: boolean
  planPath: string
}

const PLANNABLE = ['BASELINE_DONE', 'BASELINE_PARTIAL', 'PLANNED']

/** Appels persistés en baseline, éligibles au fuzz (tests verts et stables). */
export function eligibleCalls(ctx: EngineContext, runId: string): ObservedCall[] {
  const eligible = new Set(
    ctx.reader
      .tests(runId)
      .filter((t) => t.status === 'passed' && !t.flaky)
      .map((t) => t.testId),
  )
  return ctx.reader
    .callSites(runId)
    .filter((c) => eligible.has(c.testId))
    .map((c, i) => ({
      callId: i,
      callSiteId: c.callSiteId,
      testId: c.testId,
      module: c.module,
      export: c.export,
      depth: c.depth,
      sequence: c.sequence,
      argsFingerprint: c.argsFingerprint,
      args: c.args as Json[] | null,
      mutated: false,
      outcome: c.outcome as ObservedCall['outcome'],
    }))
}

/**
 * Estimation (CDC §35) : mutations × durée mesurée d'un processus de baseline (démarrage compris).
 * Borne plutôt haute : une mutation n'exécute qu'un fichier de test. Mesuré : exemple 226 s estimés
 * pour 223 s réels ; projet externe ≈ 2× surestimé (reports/j1.md).
 */
export function estimateMs(baselineMs: number, _testFiles: number, mutations: number): number {
  return Math.round(mutations * baselineMs)
}

/**
 * Ciblage (CDC §27, B-02) : `--test` (sous-chaîne du nom complet du test), `--file` (fichier de test
 * ou module de la cible : chemin ou glob), `--function` (`export` ou `module#export`), `--strategy`.
 * Toujours appliqué à la PLANIFICATION ; un ciblage qui réduit le périmètre rend le run partiel.
 */
export interface PlanFilters {
  tests?: string[]
  files?: string[]
  functions?: string[]
  strategies?: string[]
}

export interface PlanRunOptions {
  seed?: number
  maxMutations?: number
  changed?: string
  filters?: PlanFilters
}

const some = (list: string[] | undefined) => list !== undefined && list.length > 0

/** Prédicat du ciblage sur un appel observé (nom et fichier de son test, module et export). */
export function callFilter(
  f: PlanFilters,
): (c: { module: string; export: string; testName: string; testFile: string }) => boolean {
  const files = (f.files ?? []).map((g) => new RegExp(`^${globToRegExpSource(g)}$`))
  return (c) =>
    (!some(f.tests) || (f.tests ?? []).some((t) => c.testName.includes(t))) &&
    (!some(f.functions) ||
      (f.functions ?? []).some((x) => x === c.export || x === `${c.module}#${c.export}`)) &&
    (!some(f.files) || files.some((r) => r.test(c.testFile) || r.test(c.module)))
}

/** Génère, enregistre et persiste le plan d'un run issu d'une baseline (déterministe par graine). */
export function planRun(ctx: EngineContext, runId: string, o: PlanRunOptions = {}): PlanSummary {
  const run = ctx.reader.getRun(runId)
  if (run === null || !PLANNABLE.includes(run.state))
    throw new VariaError(
      'PROJECT_FAILURE',
      `run ${runId} sans baseline valide (${run?.state ?? 'inconnu'})`,
    )
  const p = ctx.config.parsed
  const configured = p.mutations.seed
  const seed = o.seed ?? (configured === 'auto' ? randomBytes(4).readUInt32BE(0) : configured)
  const tests = new Map(
    ctx.reader.tests(runId).map((t) => [t.testId, { file: t.file, name: t.name }]),
  )
  // Appels éligibles = appels de tests verts DE CE RUN : leur test est toujours connu.
  const testOf = (c: ObservedCall) => tests.get(c.testId) as { file: string; name: string }
  const total = Math.min(p.mutations.limits.total_mutations, o.maxMutations ?? Infinity)
  const f = o.filters ?? {}
  // Stratégies externes actives (J4 X-02) : connues de `--strategy` comme les intégrées.
  const session = pluginSession(ctx)
  const external = session.strategyIds()
  const unknown = (f.strategies ?? []).filter(
    (x) => !(STRATEGY_NAMES as readonly string[]).includes(x) && !external.includes(x),
  )
  if (unknown.length > 0) throw new VariaError('CONFIG_FAILURE', 'stratégie inconnue', unknown)
  const all = eligibleCalls(ctx, runId)
  const keepCall = callFilter(f)
  let calls = all.filter((c) =>
    keepCall({
      module: c.module,
      export: c.export,
      testName: testOf(c).name,
      testFile: testOf(c).file,
    }),
  )
  const wanted = f.strategies ?? []
  const strategies = some(wanted)
    ? ctx.config.strategies.filter((x) => wanted.includes(x))
    : ctx.config.strategies
  const externalWanted = some(wanted) ? external.filter((x) => wanted.includes(x)) : external
  const targeted =
    calls.length < all.length ||
    strategies.length < ctx.config.strategies.length ||
    externalWanted.length < external.length
  let incremental: Record<string, unknown> | null = null
  let reduced = false
  if (o.changed !== undefined) {
    const scope = changedFiles(ctx.root, o.changed)
    const keep = incrementalFilter(ctx, scope)
    if (keep !== null) {
      const before = calls.length
      calls = calls.filter((c) => keep({ module: c.module, testFile: testOf(c).file }))
      reduced = calls.length < before
    }
    incremental = {
      base: scope.base,
      changedFiles: scope.files,
      scope: keep === null ? 'FULL_FALLBACK' : reduced ? 'PARTIAL' : 'FULL',
    }
  }
  const limits = {
    stringLength: p.mutations.limits.string_length,
    arrayLength: p.mutations.limits.array_length,
    objectDepth: p.mutations.limits.object_depth,
  }
  const catalog = catalogFromCalls(ctx, calls)
  // Entrées déjà masquées (une valeur redigée n'est pas mutable) ; deux générations par stratégie.
  const extra = session.generate(
    catalog.filter((i) => i.mutable),
    seed,
    limits,
    externalWanted,
  )
  announceNew(ctx)
  const plan = generatePlan(catalog, {
    seed,
    perInput: ctx.config.perInput,
    strategies,
    variaVersion: VARIA_VERSION,
    configHash: ctx.config.hash,
    gitCommit: run.gitCommit,
    tests,
    perTarget: p.mutations.per_target,
    total,
    extraValues: p.inputs.values as Record<string, Json[]>,
    context: limits,
    extraCandidates: (i) => extra.get(`${i.callSiteId}|${i.pathStr}`) ?? [],
  })
  const summary = savePlan(ctx, runId, plan)
  recordPlugins(ctx, runId)
  // Run vérifié existant à l'entrée : son `info` est relu après `savePlan`, qui l'a enrichi.
  const info = () => (ctx.reader.getRun(runId) as RunRecord).info
  if (targeted) {
    ctx.writer.updateRun(runId, { partial: true, info: { ...info(), filters: f } })
  }
  if (incremental !== null) {
    // Partiel seulement si le périmètre est RÉELLEMENT réduit (CDC §29, B-10) : un repli complet ou un
    // filtre qui garde tout exécute le périmètre entier ; l'étiquette suit le fait, pas l'intention.
    ctx.writer.updateRun(runId, {
      partial: run.partial || targeted || reduced,
      info: { ...info(), incremental },
    })
  }
  return summary
}

/** Enregistre un plan (généré ou importé par `--plan`) pour un run ; il REMPLACE le plan précédent. */
export function savePlan(ctx: EngineContext, runId: string, plan: Plan): PlanSummary {
  // Toujours un run existant (issu d'une baseline) : `planRun` ou `varia fuzz --plan`.
  const run = ctx.reader.getRun(runId) as RunRecord
  const planPath = join(ctx.dataDir, 'plans', `${runId}.json`)
  mkdirSync(join(ctx.dataDir, 'plans'), { recursive: true })
  writeFileSync(planPath, serializePlan(plan))
  ctx.writer.clearPlan(runId)
  ctx.writer.saveMutations(runId, plan.mutations)
  const info = run.info
  const estimate = estimateMs(
    Number(info['baselineDurationMs'] ?? 0),
    Number(info['testFiles'] ?? 1),
    plan.mutations.length,
  )
  const warn = estimate > ctx.config.parsed.execution.warn_after_ms
  const sampled = plan.possible > plan.mutations.length
  ctx.writer.updateRun(runId, {
    state: 'PLANNED',
    seed: plan.seed,
    planPath,
    info: {
      ...info,
      plan: {
        possible: plan.possible,
        planned: plan.mutations.length,
        sampled,
        estimateMs: estimate,
      },
    },
  })
  ctx.writer.event(runId, 'PLAN_CREATED', {
    possible: plan.possible,
    planned: plan.mutations.length,
    seed: plan.seed,
  })
  ctx.emit({
    type: 'plan',
    mutations: plan.mutations.length,
    possible: plan.possible,
    estimateMs: estimate,
    warn,
  })
  return {
    runId,
    seed: plan.seed,
    possible: plan.possible,
    planned: plan.mutations.length,
    sampled,
    estimateMs: estimate,
    warn,
    planPath,
  }
}

export function readPlan(path: string): Plan {
  if (!existsSync(path)) throw new VariaError('INFRA_FAILURE', `plan introuvable : ${path}`)
  const plan = JSON.parse(readFileSync(path, 'utf8')) as Plan
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.mutations))
    throw new VariaError('CONFIG_FAILURE', `plan invalide : ${path}`)
  return plan
}
