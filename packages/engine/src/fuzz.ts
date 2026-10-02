import {
  classify,
  groupIssues,
  issueStates,
  evaluateAcceptances,
  type Acceptance,
  type Classification,
  type Plan,
  type PlannedMutation,
} from '@varia/core'
import type { RunRecord } from '@varia/database'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { prepareContext } from './baseline.js'
import { cacheKey, projectContentHash } from './cache.js'
import type { EngineContext } from './context.js'
import { VariaError } from './errors.js'
import { guardProject } from './integrity.js'
import { readPlan } from './planning.js'
import { filesystemEnv, resetDatabase, resetSucceeded } from './reset.js'
import { probeErrorCount } from './signals.js'

export interface FuzzOptions {
  maxTimeMs?: number
  /** `--no-cache` : ignore le cache même si `cache.enabled`. */
  noCache?: boolean
  /** Signal d'arrêt (Ctrl+C) : le run est marqué partiel, rien n'est perdu. */
  signal?: AbortSignal
}

export interface FuzzSummary {
  runId: string
  executed: number
  alreadyDone: number
  pending: number
  partial: boolean
  aborted: boolean
  /** Arrêt par `--max-time` : run partiel, annoncé. */
  budgetCut: boolean
}

export function oracleConfig(ctx: EngineContext) {
  const o = ctx.config.parsed.oracle
  return {
    handledErrors: ctx.config.handledErrors,
    handledRules: ctx.config.handledRules,
    crashErrors: o.crash_errors,
    suspiciousAccept: o.suspicious_accept,
    slowFactor: o.slow_factor,
    slowFloorMs: o.slow_floor_ms,
  }
}

/** Appel observé pendant l'exécution d'une mutation (diagnostic : seul l'appel visé doit être muté). */
export interface ExecutedCall {
  callSiteId: string
  module: string
  export: string
  depth: number
  sequence: number
  argsFingerprint: string
  mutated: boolean
}

export interface MutationExecution {
  classification: Classification
  /** Durée du test visé rapportée par le runner (`null` si inconnue). */
  testDurationMs: number | null
  durationMs: number
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  calls: ExecutedCall[]
}

/** Exécute UNE mutation dans un processus isolé, limité au test visé, puis la classe (§16.1, §18). */
export async function executeMutation(
  ctx: EngineContext,
  m: PlannedMutation,
  planPath: string,
  tmpDir: string,
  /** Durée du test visé en baseline (drapeau SLOW, CDC §18.9). */
  baselineTestMs: number | null = null,
): Promise<MutationExecution> {
  const runDir = join(tmpDir, m.id)
  mkdirSync(runDir, { recursive: true })
  try {
    // Reset de base avant la mutation (CDC §16.4) : un échec n'est jamais imputé à la cible.
    const reset = await resetDatabase(ctx, join(runDir, 'reset'))
    if (reset !== null && !resetSucceeded(reset)) {
      return {
        classification: { status: 'INFRA_ERROR', reason: 'RESET_FAILED', testStatus: null },
        testDurationMs: null,
        durationMs: reset.durationMs,
        exitCode: reset.exitCode,
        signal: reset.signal,
        timedOut: reset.timedOut,
        calls: [],
      }
    }
    const run = await ctx.adapter.run({
      mode: 'fuzz',
      runDir,
      timeoutMs: ctx.config.parsed.execution.timeout_ms,
      testFile: m.testFile,
      testName: m.testName,
      planPath,
      mutationId: m.id,
      maxOutputBytes: ctx.config.parsed.execution.max_output_bytes,
      env: filesystemEnv(ctx, runDir),
    })
    const mutateEvents = run.events.filter((e) => e.type === 'MUTATE_CALL' && e.mutationId === m.id)
    const appliedCall = mutateEvents.find((e) => e.applied === true)?.callId
    const observe = run.events.find((e) => e.type === 'OBSERVE_CALL' && e.callId === appliedCall)
    const outcomeEvent = run.events.find(
      (e) =>
        (e.type === 'TARGET_RETURN' || e.type === 'TARGET_THROW' || e.type === 'TARGET_REJECT') &&
        e.callId === appliedCall,
    )
    const mutatedCall =
      observe === undefined
        ? undefined
        : {
            callId: observe.callId ?? 0,
            callSiteId: observe.callSiteId ?? '',
            testId: observe.testId ?? '',
            module: observe.module ?? '',
            export: observe.export ?? '',
            depth: observe.depth ?? 0,
            sequence: observe.sequence ?? 0,
            argsFingerprint: observe.argsFingerprint ?? '',
            args: observe.args ?? null,
            mutated: true,
            outcome:
              outcomeEvent === undefined
                ? { kind: 'none' as const, async: false }
                : outcomeEvent.type === 'TARGET_RETURN'
                  ? {
                      kind: 'return' as const,
                      async: outcomeEvent.async === true,
                      ...(outcomeEvent.value !== undefined ? { value: outcomeEvent.value } : {}),
                    }
                  : {
                      kind:
                        outcomeEvent.type === 'TARGET_THROW'
                          ? ('throw' as const)
                          : ('reject' as const),
                      async: outcomeEvent.type === 'TARGET_REJECT',
                      ...(outcomeEvent.error !== undefined ? { error: outcomeEvent.error } : {}),
                    },
          }
    const hint = ctx.config.parsed.inputs.hints.find((h) => h.path === `${m.export}#${m.pathStr}`)
    const testResult = run.tests?.find((t) => t.testId === m.testId)
    const testStatus = testResult?.status ?? null
    const classification = classify(
      {
        mutation: m,
        process: run.process,
        hello: run.events.some((e) => e.type === 'HELLO'),
        reportPresent: run.tests !== null,
        testStatus,
        mutateEvents,
        mutatedCall,
        ...(hint !== undefined ? { hint } : {}),
        probeErrors: probeErrorCount(run),
        rejections: run.events.filter((e) => e.type === 'UNHANDLED_REJECTION'),
        baselineTestMs,
        testDurationMs: testResult?.durationMs ?? null,
      },
      oracleConfig(ctx),
    )
    const calls = run.events
      .filter((e) => e.type === 'OBSERVE_CALL' && e.testId === m.testId)
      .map((e) => ({
        callSiteId: e.callSiteId ?? '',
        module: e.module ?? '',
        export: e.export ?? '',
        depth: e.depth ?? 0,
        sequence: e.sequence ?? 0,
        argsFingerprint: e.argsFingerprint ?? '',
        mutated: e.mutated === true,
      }))
    return {
      classification,
      testDurationMs: testResult?.durationMs ?? null,
      durationMs: run.process.durationMs,
      exitCode: run.process.exitCode,
      signal: run.process.signal,
      timedOut: run.process.timedOut,
      calls,
    }
  } finally {
    rmSync(runDir, { recursive: true, force: true })
  }
}

/** Fuzz séquentiel (CDC §16) : chaque résultat est persisté dès son ingestion ; reprise idempotente. */
export async function runFuzz(
  ctx: EngineContext,
  runId: string,
  o: FuzzOptions = {},
): Promise<FuzzSummary> {
  const run = ctx.reader.getRun(runId)
  if (run === null || run.planPath === null)
    throw new VariaError('PROJECT_FAILURE', `run ${runId} sans plan`)
  const planPath = run.planPath
  const plan: Plan = readPlan(planPath)
  // Projet vérifié inchangé avant/après ; un run qui l'a modifié est marqué PROJECT_MUTATED (B-01).
  return guardProject(
    ctx,
    () => runId,
    () => fuzzRun(ctx, run, planPath, plan, o),
  )
}

async function fuzzRun(
  ctx: EngineContext,
  run: RunRecord,
  planPath: string,
  plan: Plan,
  o: FuzzOptions,
): Promise<FuzzSummary> {
  const runId = run.id
  const done = ctx.reader.resultIds(runId)
  const invocation = String(ctx.reader.events(runId, 'FUZZ_STARTED').length + 1)
  const tmpDir = join(ctx.dataDir, 'tmp', `${runId}-fuzz-${invocation}`)
  mkdirSync(tmpDir, { recursive: true })
  await ctx.adapter.prepare(prepareContext(ctx, runId, tmpDir))
  ctx.writer.updateRun(runId, { state: 'FUZZING' })
  ctx.writer.event(runId, 'FUZZ_STARTED', { invocation, alreadyDone: done.size })
  const started = performance.now()
  let executed = 0
  let cut = false
  const todo = plan.mutations.filter((m) => !done.has(m.id))
  const baselineMs = new Map(ctx.reader.tests(runId).map((t) => [t.testId, t.durationMs]))
  const useCache = ctx.config.parsed.cache.enabled && o.noCache !== true
  const contentHash = useCache ? projectContentHash(ctx) : ''
  let cacheHits = 0
  let cacheMisses = 0
  try {
    for (const [index, m] of todo.entries()) {
      if (
        o.signal?.aborted === true ||
        (o.maxTimeMs !== undefined && performance.now() - started > o.maxTimeMs)
      ) {
        cut = true
        break
      }
      if (useCache) {
        const hit = ctx.reader.cachedResult(cacheKey(ctx, run.envHash, contentHash, m))
        if (hit !== null) {
          ctx.writer.saveResult(runId, { ...hit, mutationId: m.id })
          ctx.writer.event(runId, 'CACHE_HIT', { mutationId: m.id })
          cacheHits++
          executed++
          continue
        }
        cacheMisses++
      }
      ctx.writer.event(runId, 'MUTATION_STARTED', { mutationId: m.id, invocation })
      const r = await executeMutation(ctx, m, planPath, tmpDir, baselineMs.get(m.testId) ?? null)
      const c = r.classification
      const record = {
        mutationId: m.id,
        status: c.status,
        subtype: c.subtype ?? null,
        reason: c.reason ?? null,
        outcome: c.outcome ?? null,
        testStatus: c.testStatus,
        durationMs: r.durationMs,
        exitCode: r.exitCode,
        signal: r.signal,
        timedOut: r.timedOut,
        error: c.error ?? null,
        echoPath: c.echoPath ?? null,
        flags: c.flags ?? [],
        testDurationMs: r.testDurationMs,
      }
      ctx.writer.saveResult(runId, record)
      if (useCache) ctx.writer.cacheResult(cacheKey(ctx, run.envHash, contentHash, m), record)
      ctx.writer.event(runId, 'MUTATION_COMPLETED', { mutationId: m.id, status: c.status })
      executed++
      ctx.emit({
        type: 'mutation',
        index: done.size + index + 1,
        of: plan.mutations.length,
        id: m.id,
        status: c.status,
        ...(c.subtype !== undefined ? { subtype: c.subtype } : {}),
      })
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
  analyze(ctx, runId, plan)
  const results = ctx.reader.results(runId)
  const pending = plan.mutations.length - results.length
  const partial = pending > 0 || run.partial
  ctx.writer.updateRun(runId, {
    state: o.signal?.aborted === true ? 'ABORTED' : 'COMPLETED',
    partial,
  })
  if (useCache)
    ctx.writer.updateRun(runId, {
      info: {
        ...(ctx.reader.getRun(runId)?.info ?? {}),
        cache: { hits: cacheHits, misses: cacheMisses, contentHash },
      },
    })
  ctx.writer.event(runId, 'RUN_COMPLETED', { executed, pending, partial })
  return {
    runId,
    executed,
    alreadyDone: done.size,
    pending,
    partial,
    aborted: o.signal?.aborted === true,
    budgetCut: cut && o.signal?.aborted !== true,
  }
}

/** Regroupement des issues (§20) à partir de tous les résultats persistés du run. */
export function analyze(ctx: EngineContext, runId: string, plan: Plan): void {
  const byId = new Map(plan.mutations.map((m) => [m.id, m]))
  const results = ctx.reader.results(runId).flatMap((r) => {
    const mutation = byId.get(r.mutationId)
    if (mutation === undefined) return []
    const classification: Classification = {
      status: r.status as Classification['status'],
      testStatus: r.testStatus,
      ...(r.subtype !== null
        ? { subtype: r.subtype as NonNullable<Classification['subtype']> }
        : {}),
      ...(r.reason !== null ? { reason: r.reason } : {}),
      ...(r.error !== null ? { error: r.error as NonNullable<Classification['error']> } : {}),
      ...((r.flags ?? []).length > 0 ? { flags: r.flags } : {}),
    }
    return [{ mutation, classification }]
  })
  const drafts = groupIssues(results, ctx.root)
  const run = ctx.reader.getRun(runId)
  // Référence (C-02) : dernier run COMPLET (ni partiel, ni ayant modifié le projet) de ce projet.
  const previous = ctx.reader
    .listRuns(200)
    .find(
      (r) =>
        r.projectId === ctx.projectId && r.id !== runId && r.state === 'COMPLETED' && !r.partial,
    )
  // « Déjà vue » : dans un run valide seulement (un run PROJECT_MUTATED ne fait pas d'historique).
  const valid = (id: string) => ctx.reader.getRun(id)?.state !== 'PROJECT_MUTATED'
  const everSeen = new Set(
    drafts
      .map((d) => d.fingerprint)
      .filter((id) =>
        ctx.reader.issueHistory(id).some((h) => h.runId !== runId && h.count > 0 && valid(h.runId)),
      ),
  )
  const states = issueStates({
    current: drafts.map((d) => ({
      id: d.fingerprint,
      target: d.target,
      count: d.mutationIds.length,
    })),
    previous:
      previous === undefined
        ? null
        : ctx.reader
            .issues(previous.id)
            .filter((i) => i.count > 0)
            .map((i) => ({
              id: i.id,
              target: i.target,
              count: i.count,
              mutationIds: i.mutationIds,
            })),
    everSeen,
    executedTargets: new Set(results.map((r) => `${r.mutation.module}#${r.mutation.export}`)),
    executedMutations: new Set(results.map((r) => r.mutation.id)),
    partial: (run?.partial ?? false) || results.length < plan.mutations.length,
  })
  const evaluation = evaluateAcceptances(
    loadAcceptances(ctx),
    plan.mutations,
    new Date().toISOString().slice(0, 10),
  )
  const fullyAccepted = (d: (typeof drafts)[number]) =>
    d.mutationIds.length > 0 && d.mutationIds.every((id) => evaluation.accepted.has(id))
  ctx.writer.saveIssues(
    runId,
    ctx.projectId,
    drafts.map((d) => ({
      ...d,
      state: fullyAccepted(d) ? 'ACCEPTED' : (states.present.get(d.fingerprint) ?? 'NEW'),
    })),
  )
  ctx.writer.saveAbsentIssues(runId, states.absent)
  ctx.writer.updateRun(runId, {
    info: {
      ...(ctx.reader.getRun(runId)?.info ?? {}),
      ...(previous !== undefined ? { comparedTo: previous.id } : {}),
      acceptances: evaluation.statuses.map((x) => ({
        ...x.acceptance,
        status: x.status,
        matched: x.matched,
      })),
      acceptedMutations: Object.fromEntries(evaluation.accepted),
    },
  })
  for (const d of drafts) ctx.writer.event(runId, 'ISSUE_CREATED', { issueId: d.fingerprint })
}

/** Acceptations du projet : `varia.yml` (`store: file`, forme abrégée ou `{ store, items }`) + base. */
export function loadAcceptances(ctx: EngineContext): Acceptance[] {
  const raw = ctx.config.parsed.acceptances
  const items = Array.isArray(raw) ? raw : raw.items
  const fromFile: Acceptance[] = items.map((a, n) => ({
    id: `file:${String(n)}`,
    source: 'file',
    function: a.mutation_pattern.function,
    path: a.mutation_pattern.path,
    strategy: a.mutation_pattern.strategy,
    reason: a.reason,
    owner: a.owner,
    expires: a.expires,
  }))
  const fromDb: Acceptance[] = ctx.reader.acceptances(ctx.projectId).map((a) => ({
    id: a.id,
    source: 'db',
    function: a.function,
    path: a.path ?? undefined,
    strategy: a.strategy ?? undefined,
    reason: a.reason,
    owner: a.owner ?? undefined,
    expires: a.expires ?? undefined,
  }))
  return [...fromFile, ...fromDb]
}
