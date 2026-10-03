import {
  mockedTargets,
  buildCatalog,
  compareBaselines,
  observationOf,
  type InputDescriptor,
  type Observation,
  type ObservedCall,
  type CoverageRow,
} from '@varia/core'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { printableConfig } from '@varia/config'
import { PROTOCOL_VERSION, unsupportedProbeVersion } from '@varia/probe-protocol'
import type { EngineContext } from './context.js'
import { lastDoctorVerification } from './doctor.js'
import { VariaError } from './errors.js'
import { guardProject } from './integrity.js'
import { probeErrorCount } from './signals.js'
import { VARIA_VERSION } from './version.js'

export interface BaselineOptions {
  allowFailing?: boolean
  force?: boolean
}

export interface BaselineSummary {
  runId: string
  state: 'BASELINE_DONE' | 'BASELINE_PARTIAL' | 'BASELINE_FAILED'
  tests: number
  passed: number
  failing: string[]
  flaky: { name: string; reasons: string[] }[]
  calls: number
  targets: { observed: number; neverCalled: number; unsupported: number; transitiveOnly: number }
  inputs: { mutable: number; nonMutable: number }
  durationMs: number
}

export const newRunId = () => 'r_' + randomBytes(6).toString('hex')

export function prepareContext(ctx: EngineContext, runId: string, tmpDir: string) {
  const p = ctx.config.parsed
  return {
    root: ctx.root,
    cwd: ctx.testCwd,
    env: p.test.env,
    tmpDir,
    runId,
    include: p.targets.include,
    exclude: p.targets.exclude,
    redact: {
      fields: p.redaction.fields,
      patterns: p.redaction.patterns,
      skipPaths: p.inputs.skip,
      hmacKey: ctx.hmacKey(),
    },
    ...(p.test.node_options !== undefined ? { nodeOptions: p.test.node_options } : {}),
    memoryMb: p.mutations.limits.memory_mb,
  }
}

/** Filtre de targets pour les modes `declared` / `hybrid` (CDC §11). */
export function targetFilter(ctx: EngineContext): ((m: string, e: string) => boolean) | undefined {
  const t = ctx.config.parsed.targets
  const matches = (list: string[], m: string, e: string) =>
    list.some((d) => d === e || d === `${m}#${e}`)
  if (t.mode === 'declared') return (m, e) => matches(t.declared, m, e)
  if (t.mode === 'hybrid') return (m, e) => !matches(t.remove, m, e)
  return undefined
}

export function catalogFromCalls(ctx: EngineContext, calls: ObservedCall[]): InputDescriptor[] {
  const p = ctx.config.parsed
  const allow = targetFilter(ctx)
  return buildCatalog(calls, {
    skip: p.inputs.skip,
    hints: p.inputs.hints,
    includeTransitive: p.targets.depth === 'all',
    ...(allow !== undefined ? { allow } : {}),
  })
}

/**
 * Baseline + stabilité (CDC §8) : observe, compare, persiste ; aucune mutation. Le projet est vérifié
 * inchangé avant/après (CDC §5, B-01).
 */
export async function runBaseline(
  ctx: EngineContext,
  o: BaselineOptions = {},
): Promise<BaselineSummary> {
  let runId: string | null = null
  return guardProject(
    ctx,
    () => runId,
    () =>
      baselineOf(ctx, o, (id) => {
        runId = id
      }),
  )
}

async function baselineOf(
  ctx: EngineContext,
  o: BaselineOptions,
  onRun: (id: string) => void,
): Promise<BaselineSummary> {
  const detect = await ctx.adapter.detect(ctx.root)
  if (!detect.detected)
    throw new VariaError('RUNNER_FAILURE', `${ctx.adapter.id} non détecté`, detect.reasons)
  if (detect.nativeEsm)
    throw new VariaError(
      'UNSUPPORTED_PROBE',
      'injection de la sonde impossible (ESM natif)',
      detect.reasons,
    )
  const runId = newRunId()
  onRun(runId)
  const git = ctx.git()
  ctx.writer.upsertProject({
    id: ctx.projectId,
    name: ctx.config.projectName,
    root: ctx.root,
    framework: ctx.adapter.id,
  })
  ctx.writer.createRun({
    id: runId,
    projectId: ctx.projectId,
    state: 'BASELINE_RUNNING',
    mode: ctx.config.parsed.mutations.mode,
    seed: null,
    gitCommit: git.commit,
    gitBranch: git.branch,
    variaVersion: VARIA_VERSION,
    configHash: ctx.config.hash,
    envHash: ctx.envHash(detect.version),
    planPath: null,
    partial: false,
    info: {
      adapterVersion: detect.version,
      projectName: ctx.config.projectName,
      projectRoot: ctx.root,
      adapter: ctx.adapter.id,
      capabilities: ctx.adapter.capabilities(),
      depth: ctx.config.parsed.targets.depth,
    },
  })
  ctx.writer.saveConfig(runId, printableConfig(ctx.config))
  ctx.writer.event(runId, 'RUN_STARTED')
  ctx.writer.event(runId, 'BASELINE_STARTED')
  const tmpDir = join(ctx.dataDir, 'tmp', runId)
  // Dossier temporaire toujours nettoyé, même si la baseline échoue (B-04), sauf --keep-tmp.
  const { observations, coverageRows, firstDuration, probeErrors, unhandledRejections, started } =
    await observe(ctx, runId, tmpDir).finally(() => ctx.discardTmp(tmpDir))
  const first = observations[0] as Observation
  const stability = compareBaselines(observations)
  const flakyById = new Map(stability.flaky.map((f) => [f.testId, f.reasons]))
  const failing = first.tests.filter((t) => t.status === 'failed').map((t) => t.name)
  ctx.writer.saveTests(
    runId,
    first.tests.map((t) => ({
      testId: t.testId,
      file: t.file,
      name: t.name,
      status: t.status,
      flakyReasons: flakyById.get(t.testId) ?? [],
      durationMs: t.durationMs,
    })),
  )
  const nd = new Set(stability.nonDeterministicCallSites)
  ctx.writer.saveCallSites(
    runId,
    first.calls.map((c) => ({
      callSiteId: c.callSiteId,
      testId: c.testId,
      module: c.module,
      export: c.export,
      depth: c.depth,
      sequence: c.sequence,
      argsFingerprint: c.argsFingerprint,
      args: c.args,
      outcome: c.outcome,
      nonDeterministic: nd.has(c.callSiteId),
    })),
  )
  const targets = targetStatuses(first)
  ctx.writer.saveTargets(runId, targets)
  if (coverageRows !== null) ctx.writer.saveCoverage(runId, coverageRows)
  const eligible = new Set(
    first.tests
      .filter((t) => t.status === 'passed' && !flakyById.has(t.testId))
      .map((t) => t.testId),
  )
  const catalog = catalogFromCalls(
    ctx,
    first.calls.filter((c) => eligible.has(c.testId)),
  )
  ctx.writer.saveInputs(
    runId,
    catalog.map((i) => ({
      callSiteId: i.callSiteId,
      path: i.pathStr,
      type: i.type,
      format: i.format ?? null,
      bounds: i.bounds ?? null,
      mutable: i.mutable,
      reason: i.reason ?? null,
    })),
  )
  const state: BaselineSummary['state'] =
    failing.length === 0
      ? 'BASELINE_DONE'
      : o.force === true
        ? 'BASELINE_PARTIAL'
        : 'BASELINE_FAILED'
  // Capacités VÉRIFIÉES par le dernier `varia doctor` du même adapter (D-01) ; sans lui, aucune.
  const verified = lastDoctorVerification(ctx.dataDir, ctx.adapter.id)
  const info = {
    ...(verified !== null ? { verified } : {}),
    adapterVersion: detect.version,
    projectName: ctx.config.projectName,
    projectRoot: ctx.root,
    adapter: ctx.adapter.id,
    capabilities: ctx.adapter.capabilities(),
    depth: ctx.config.parsed.targets.depth,
    baselineDurationMs: firstDuration,
    testFiles: new Set(first.tests.map((t) => t.file)).size,
    probeTruncatedLines: observations.reduce((n, x) => n + x.truncatedLines, 0),
    probeInvalidLines: observations.reduce((n, x) => n + x.invalidLines, 0),
    probeErrors,
    unhandledRejections,
    failing,
    // Cibles déclarées mockées par un fichier de test : jamais observables là (E-03, §10.10).
    mockedTargets: mockedTargets(
      ctx.root,
      first.tests.map((t) => t.file),
      ctx.config.parsed.targets,
    ),
    coverage: ctx.config.parsed.coverage.baseline
      ? coverageRows === null
        ? 'UNAVAILABLE'
        : 'COLLECTED'
      : 'DISABLED',
  }
  ctx.writer.updateRun(runId, { state, partial: state === 'BASELINE_PARTIAL', info })
  ctx.writer.event(runId, 'BASELINE_COMPLETED', { state })
  const count = (s: string) => targets.filter((t) => t.status === s).length
  const summary: BaselineSummary = {
    runId,
    state,
    tests: first.tests.length,
    passed: first.tests.length - failing.length,
    failing,
    flaky: stability.flaky.map((f) => ({ name: f.name, reasons: f.reasons })),
    calls: first.calls.length,
    targets: {
      observed: count('OBSERVED'),
      neverCalled: count('NEVER_CALLED'),
      unsupported: count('UNSUPPORTED'),
      transitiveOnly: count('TRANSITIVE_ONLY'),
    },
    inputs: {
      mutable: catalog.filter((i) => i.mutable).length,
      nonMutable: catalog.filter((i) => !i.mutable).length,
    },
    durationMs: performance.now() - started,
  }
  if (state === 'BASELINE_FAILED' && o.allowFailing !== true) {
    throw new VariaError(
      'BASELINE_FAILED',
      `${String(failing.length)} test(s) en échec en baseline`,
      failing,
    )
  }
  return summary
}

/** Statut de chaque export enveloppé : observé, seulement transitif, jamais appelé, non supporté (§11). */
export function targetStatuses(
  o: Observation,
): { module: string; export: string; status: string }[] {
  const out: { module: string; export: string; status: string }[] = []
  for (const [module, d] of Object.entries(o.discovered)) {
    for (const exp of d.wrapped) {
      const calls = o.calls.filter((c) => c.module === module && c.export === exp)
      const status =
        calls.length === 0
          ? 'NEVER_CALLED'
          : calls.some((c) => c.depth === 0)
            ? 'OBSERVED'
            : 'TRANSITIVE_ONLY'
      out.push({ module, export: exp, status })
    }
    for (const exp of d.unsupported) out.push({ module, export: exp, status: 'UNSUPPORTED' })
  }
  return out.sort((a, b) => (`${a.module}#${a.export}` < `${b.module}#${b.export}` ? -1 : 1))
}

/** Exécutions d'observation (stabilité) et couverture de baseline, dans `tmpDir`. */
async function observe(ctx: EngineContext, runId: string, tmpDir: string) {
  mkdirSync(tmpDir, { recursive: true })
  await ctx.adapter.prepare(prepareContext(ctx, runId, tmpDir))
  const observations: Observation[] = []
  // Erreurs de la sonde et rejets non gérés pendant la baseline : comptés et rapportés (A-02, A-05).
  let probeErrors = 0
  let unhandledRejections = 0
  let coverageRows: CoverageRow[] | null = null
  const started = performance.now()
  let firstDuration = 0
  const timeoutMs = Math.max(120_000, ctx.config.parsed.execution.timeout_ms * 20)
  for (let i = 0; i < ctx.config.stabilityRuns; i++) {
    const runDir = join(tmpDir, `baseline-${i}`)
    mkdirSync(runDir, { recursive: true })
    const run = await ctx.adapter.run({ mode: 'observe', runDir, timeoutMs })
    if (run.tests === null) {
      ctx.writer.updateRun(runId, { state: 'FAILED' })
      throw new VariaError(
        'RUNNER_FAILURE',
        `le runner n'a produit aucun résultat (code ${String(run.process.exitCode)}${run.process.timedOut ? ', timeout' : ''})`,
        [run.process.stderr.slice(-2000)],
      )
    }
    probeErrors += probeErrorCount(run)
    unhandledRejections += run.events.filter((e) => e.type === 'UNHANDLED_REJECTION').length
    // P-03 : une sonde d'une version MAJEURE inconnue est refusée avant toute interprétation.
    const foreign = unsupportedProbeVersion(run.events)
    if (foreign !== null) {
      ctx.writer.updateRun(runId, { state: 'FAILED' })
      throw new VariaError(
        'UNSUPPORTED_PROBE',
        'version du protocole de sonde non prise en charge',
        [probeVersionDetail(foreign)],
      )
    }
    const obs = observationOf(run)
    if (obs.helloCount === 0) {
      ctx.writer.updateRun(runId, { state: 'FAILED' })
      throw new VariaError('UNSUPPORTED_PROBE', 'la sonde ne s’est pas chargée dans le runner')
    }
    if (i === 0) firstDuration = run.process.durationMs
    observations.push(obs)
    ctx.emit({
      type: 'baseline',
      run: i + 1,
      of: ctx.config.stabilityRuns,
      passed: obs.tests.filter((t) => t.status === 'passed').length,
      total: obs.tests.length,
      durationMs: run.process.durationMs,
    })
  }
  if (ctx.config.parsed.coverage.baseline) {
    // Exécution séparée : l'instrumentation ne perturbe ni les durées ni la stabilité mesurées.
    const runDir = join(tmpDir, 'coverage-run')
    mkdirSync(runDir, { recursive: true })
    const cov = await ctx.adapter.run({ mode: 'observe', runDir, timeoutMs, coverage: true })
    coverageRows = cov.coverage ?? null
  }
  return { observations, coverageRows, firstDuration, probeErrors, unhandledRejections, started }
}

/** Détail affiché d'un refus de version (code stable, versions lue et prise en charge). */
export function probeVersionDetail(foreign: number): string {
  return `PROBE_PROTOCOL_UNSUPPORTED: protocolVersion ${foreign} (pris en charge : ${PROTOCOL_VERSION})`
}
