import {
  observationOf,
  type AdapterCapabilities,
  generatePlan,
  serializePlan,
  buildCatalog,
} from '@varia/core'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { newRunId, prepareContext } from './baseline.js'
import type { EngineContext } from './context.js'
import { mutationTimeoutMs } from './fuzz.js'
import { guardProject } from './integrity.js'
import { VARIA_VERSION } from './version.js'

export type CapabilityStatus = 'VERIFIED' | 'NOT_VERIFIED' | 'UNSUPPORTED'

export interface DoctorReport {
  node: string
  adapter: string
  adapterVersion: string | null
  detected: boolean
  nativeEsm: boolean
  /** Codes (traduits par le CLI) : RUNNER_NOT_FOUND, NATIVE_ESM, NO_TARGET_MODULE_WRAPPED, TRANSITIVE_CALLS_OBSERVED. */
  reasons: string[]
  /** `UNSUPPORTED_PROBE` : la sonde ne peut pas s'injecter (exit 5). */
  verdict: 'OK' | 'UNSUPPORTED_PROBE' | 'RUNNER_NOT_FOUND'
  declared: AdapterCapabilities
  verified: Record<keyof AdapterCapabilities, CapabilityStatus>
}

/**
 * `varia doctor` (CDC §9.2) : capacités EFFECTIVEMENT vérifiées par un test de fumée sur le projet
 * (une baseline observée + une mutation réelle), jamais seulement déclarées.
 */
export function doctor(ctx: EngineContext): Promise<DoctorReport> {
  // Le test de fumée lance le projet : vérifié inchangé avant/après (B-01).
  return guardProject(
    ctx,
    () => null,
    () => doctorOf(ctx),
  )
}

async function doctorOf(ctx: EngineContext): Promise<DoctorReport> {
  const detect = await ctx.adapter.detect(ctx.root)
  const declared = ctx.adapter.capabilities()
  const verified = Object.fromEntries(
    Object.entries(declared).map(([k, v]) => [k, v ? 'NOT_VERIFIED' : 'UNSUPPORTED']),
  ) as DoctorReport['verified']
  const base = {
    node: process.version,
    adapter: ctx.adapter.id,
    adapterVersion: detect.version,
    detected: detect.detected,
    nativeEsm: detect.nativeEsm,
    reasons: [...detect.reasons],
    declared,
    verified,
  }
  if (!detect.detected) return { ...base, verdict: 'RUNNER_NOT_FOUND' }
  if (detect.nativeEsm) {
    verified.esm = 'UNSUPPORTED'
    verified.observation = 'UNSUPPORTED'
    verified.argumentMutation = 'UNSUPPORTED'
    return { ...base, verdict: 'UNSUPPORTED_PROBE' }
  }
  const runId = newRunId()
  const tmpDir = join(ctx.dataDir, 'tmp', `${runId}-doctor`)
  mkdirSync(join(tmpDir, 'observe'), { recursive: true })
  try {
    await ctx.adapter.prepare(prepareContext(ctx, runId, tmpDir))
    const run = await ctx.adapter.run({
      mode: 'observe',
      runDir: join(tmpDir, 'observe'),
      timeoutMs: Math.max(120_000, ctx.config.parsed.execution.timeout_ms * 20),
    })
    const obs = observationOf(run)
    if (obs.helloCount === 0 || Object.keys(obs.discovered).length === 0) {
      base.reasons.push('NO_TARGET_MODULE_WRAPPED')
      verified.observation = 'UNSUPPORTED'
      return { ...base, verdict: 'UNSUPPORTED_PROBE' }
    }
    if (obs.calls.length > 0) verified.observation = 'VERIFIED'
    if (obs.calls.some((c) => c.outcome.async)) verified.asyncTargets = 'VERIFIED'
    if (obs.calls.some((c) => c.depth > 0)) base.reasons.push('TRANSITIVE_CALLS_OBSERVED')
    if (verified.observation === 'VERIFIED') {
      const esm = isEsmProject(ctx.root)
      if (esm && declared.esm) verified.esm = 'VERIFIED'
      if (!esm && declared.cjs) verified.cjs = 'VERIFIED'
    }
    verified.isolatedProcess = 'VERIFIED'
    const passing = new Set(obs.tests.filter((t) => t.status === 'passed').map((t) => t.testId))
    const catalog = buildCatalog(obs.calls.filter((c) => passing.has(c.testId))).filter(
      (i) => i.mutable,
    )
    const first = catalog[0]
    if (first !== undefined) {
      const tests = new Map(obs.tests.map((t) => [t.testId, { file: t.file, name: t.name }]))
      const plan = generatePlan([first], {
        seed: 1,
        perInput: 1,
        strategies: ['null'],
        variaVersion: VARIA_VERSION,
        configHash: '',
        tests,
      })
      const m = plan.mutations[0]
      if (m !== undefined) {
        const planPath = join(tmpDir, 'plan.json')
        writeFileSync(planPath, serializePlan(plan))
        mkdirSync(join(tmpDir, 'fuzz'), { recursive: true })
        const f = await ctx.adapter.run({
          mode: 'fuzz',
          runDir: join(tmpDir, 'fuzz'),
          timeoutMs: mutationTimeoutMs(ctx, run.process.durationMs),
          testFile: m.testFile,
          testName: m.testName,
          planPath,
          mutationId: m.id,
        })
        if (f.events.some((e) => e.type === 'MUTATE_CALL' && e.applied === true))
          verified.argumentMutation = 'VERIFIED'
        const ran = (f.tests ?? []).filter((t) => t.status !== 'skipped')
        if (f.tests !== null && ran.length === 1 && ran[0]?.testId === m.testId)
          verified.perTestSelection = 'VERIFIED'
      }
    }
    return { ...base, verdict: 'OK' }
  } finally {
    ctx.discardTmp(tmpDir)
  }
}

/** Projet déclaré ESM (`"type": "module"`). */
export function isEsmProject(root: string): boolean {
  const p = join(root, 'package.json')
  return (
    existsSync(p) && (JSON.parse(readFileSync(p, 'utf8')) as { type?: string }).type === 'module'
  )
}
