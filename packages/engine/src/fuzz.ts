import {
  classify,
  groupIssues,
  type Classification,
  type Plan,
  type PlannedMutation,
} from '@varia/core'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { prepareContext } from './baseline.js'
import type { EngineContext } from './context.js'
import { VariaError } from './errors.js'
import { snapshotProject, assertUnchanged } from './integrity.js'
import { readPlan } from './planning.js'

export interface FuzzOptions {
  maxTimeMs?: number
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
  }
}

/** Exécute UNE mutation dans un processus isolé, limité au test visé, puis la classe (§16.1, §18). */
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
  durationMs: number
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  calls: ExecutedCall[]
}

export async function executeMutation(
  ctx: EngineContext,
  m: PlannedMutation,
  planPath: string,
  tmpDir: string,
): Promise<MutationExecution> {
  const runDir = join(tmpDir, m.id)
  mkdirSync(runDir, { recursive: true })
  try {
    const run = await ctx.adapter.run({
      mode: 'fuzz',
      runDir,
      timeoutMs: ctx.config.parsed.execution.timeout_ms,
      testFile: m.testFile,
      testName: m.testName,
      planPath,
      mutationId: m.id,
      maxOutputBytes: ctx.config.parsed.execution.max_output_bytes,
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
    const testStatus = run.tests?.find((t) => t.testId === m.testId)?.status ?? null
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
  const plan: Plan = readPlan(run.planPath)
  const integrity = {
    watchIgnored: ctx.config.parsed.integrity.watch_ignored,
    ignore: ctx.config.parsed.integrity.ignore_for_integrity,
  }
  const before = snapshotProject(ctx.root, integrity)
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
  try {
    for (const [index, m] of todo.entries()) {
      if (
        o.signal?.aborted === true ||
        (o.maxTimeMs !== undefined && performance.now() - started > o.maxTimeMs)
      ) {
        cut = true
        break
      }
      ctx.writer.event(runId, 'MUTATION_STARTED', { mutationId: m.id, invocation })
      const r = await executeMutation(ctx, m, run.planPath, tmpDir)
      const c = r.classification
      ctx.writer.saveResult(runId, {
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
      })
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
  ctx.writer.event(runId, 'RUN_COMPLETED', { executed, pending, partial })
  assertUnchanged(before, snapshotProject(ctx.root, integrity))
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
    }
    return [{ mutation, classification }]
  })
  const transitive = ctx.config.parsed.ci.include_transitive
  const drafts = groupIssues(results, ctx.root)
  ctx.writer.saveIssues(runId, ctx.projectId, drafts)
  for (const d of drafts)
    ctx.writer.event(runId, 'ISSUE_CREATED', { issueId: d.fingerprint, transitive })
}
