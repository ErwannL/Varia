import { generatePlan, serializePlan, type ObservedCall, type Plan } from '@varia/core'
import type { Json } from '@varia/probe-protocol'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { catalogFromCalls } from './baseline.js'
import type { EngineContext } from './context.js'
import { VariaError } from './errors.js'
import { VARIA_VERSION } from './version.js'

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

/** Génère, enregistre et persiste le plan d'un run issu d'une baseline (déterministe par graine). */
export function planRun(
  ctx: EngineContext,
  runId: string,
  o: { seed?: number; maxMutations?: number } = {},
): PlanSummary {
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
  const total = Math.min(p.mutations.limits.total_mutations, o.maxMutations ?? Infinity)
  const plan = generatePlan(catalogFromCalls(ctx, eligibleCalls(ctx, runId)), {
    seed,
    perInput: ctx.config.perInput,
    strategies: ctx.config.strategies,
    variaVersion: VARIA_VERSION,
    configHash: ctx.config.hash,
    tests,
    perTarget: p.mutations.per_target,
    total,
    extraValues: p.inputs.values as Record<string, Json[]>,
    context: {
      stringLength: p.mutations.limits.string_length,
      arrayLength: p.mutations.limits.array_length,
      objectDepth: p.mutations.limits.object_depth,
    },
  })
  return savePlan(ctx, runId, plan)
}

/** Enregistre un plan (généré ou importé par `--plan`) pour un run ; il REMPLACE le plan précédent. */
export function savePlan(ctx: EngineContext, runId: string, plan: Plan): PlanSummary {
  const run = ctx.reader.getRun(runId)
  const planPath = join(ctx.dataDir, 'plans', `${runId}.json`)
  mkdirSync(join(ctx.dataDir, 'plans'), { recursive: true })
  writeFileSync(planPath, serializePlan(plan))
  ctx.writer.clearPlan(runId)
  ctx.writer.saveMutations(runId, plan.mutations)
  const info = run?.info ?? {}
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
