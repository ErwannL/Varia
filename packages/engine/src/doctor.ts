import {
  observationOf,
  type AdapterCapabilities,
  type AdapterRun,
  generatePlan,
  serializePlan,
  buildCatalog,
} from '@varia/core'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unsupportedProbeVersion } from '@varia/probe-protocol'
import { newRunId, prepareContext } from './baseline.js'
import type { EngineContext } from './context.js'
import { mutationTimeoutMs } from './fuzz.js'
import { guardProject } from './integrity.js'
import { VARIA_VERSION } from './version.js'

export type CapabilityStatus = 'VERIFIED' | 'NOT_VERIFIED' | 'UNSUPPORTED'
type Capability = keyof AdapterCapabilities

/** Résultat du test de fumée d'une capacité ; `reason` (code) explique tout ce qui n'est pas VERIFIED. */
export interface CapabilityCheck {
  status: CapabilityStatus
  reason: string | null
}

/** Vérification persistée par `doctor` (`<dataDir>/doctor.json`), recopiée dans les runs suivants. */
export interface DoctorVerification {
  adapter: string
  variaVersion: string
  at: string
  checks: Record<Capability, CapabilityCheck>
}

/** Capacités qu'aucun test de fumée générique ne peut exercer sans un projet construit pour : jamais VERIFIED. */
const NO_SMOKE_TEST: Capability[] = ['mocks', 'testParameters']

const DOCTOR_FILE = 'doctor.json'

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
  verified: Record<Capability, CapabilityStatus>
  /** Raison (code) de chaque capacité non VERIFIED (D-01). */
  checks: Record<Capability, CapabilityCheck>
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
  ).then((r) => {
    // Hors du projet surveillé : la vérification est rangée avec les données de Varia (D-01).
    const v: DoctorVerification = {
      adapter: r.adapter,
      variaVersion: VARIA_VERSION,
      at: new Date().toISOString(),
      checks: r.checks,
    }
    writeFileSync(join(ctx.dataDir, DOCTOR_FILE), JSON.stringify(v, null, 2) + '\n')
    return r
  })
}

async function doctorOf(ctx: EngineContext): Promise<DoctorReport> {
  const why: Partial<Record<Capability, string>> = {}
  const r = await smoke(ctx, why)
  r.checks = Object.fromEntries(
    Object.entries(r.verified).map(([k, status]) => [
      k,
      { status, reason: status === 'VERIFIED' ? null : (why[k as Capability] ?? 'NOT_EXERCISED') },
    ]),
  ) as DoctorReport['checks']
  return r
}

/**
 * Dernière vérification de `doctor` pour cet adapter et cette version de Varia, à recopier dans
 * le run (`info.verified`) ; `null` si absente, illisible ou périmée : rien n'est alors VERIFIED.
 */
export function lastDoctorVerification(
  dataDir: string,
  adapter: string,
): DoctorVerification | null {
  try {
    const v = JSON.parse(readFileSync(join(dataDir, DOCTOR_FILE), 'utf8')) as DoctorVerification
    return v.adapter === adapter && v.variaVersion === VARIA_VERSION ? v : null
  } catch {
    return null
  }
}

/** PIDs des sondes (événements HELLO) d'une exécution. */
const probePids = (r: AdapterRun) =>
  r.events.flatMap((e) => (e.type === 'HELLO' && e.pid !== undefined ? [e.pid] : []))

/** Test de fumée : statuts dans le rapport, raisons des échecs dans `why`. */
async function smoke(
  ctx: EngineContext,
  why: Partial<Record<Capability, string>>,
): Promise<DoctorReport> {
  const detect = await ctx.adapter.detect(ctx.root)
  const declared = ctx.adapter.capabilities()
  const verified = Object.fromEntries(
    Object.entries(declared).map(([k, v]) => [k, v ? 'NOT_VERIFIED' : 'UNSUPPORTED']),
  ) as DoctorReport['verified']
  for (const [k, v] of Object.entries(declared) as [Capability, boolean][])
    if (!v) why[k] = 'NOT_DECLARED'
    else if (NO_SMOKE_TEST.includes(k)) why[k] = 'NO_SMOKE_TEST'
  const base = {
    node: process.version,
    adapter: ctx.adapter.id,
    adapterVersion: detect.version,
    detected: detect.detected,
    nativeEsm: detect.nativeEsm,
    reasons: [...detect.reasons],
    declared,
    verified,
    checks: {} as DoctorReport['checks'],
  }
  if (!detect.detected) return { ...base, verdict: 'RUNNER_NOT_FOUND' }
  if (detect.nativeEsm) {
    verified.esm = 'UNSUPPORTED'
    verified.observation = 'UNSUPPORTED'
    verified.argumentMutation = 'UNSUPPORTED'
    why.esm = why.observation = why.argumentMutation = 'NATIVE_ESM'
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
      // Couverture : vérifiée seulement si le runner produit réellement un résumé.
      ...(declared.coverage ? { coverage: true } : {}),
    })
    if (declared.coverage)
      if ((run.coverage ?? []).length > 0) verified.coverage = 'VERIFIED'
      else why.coverage = 'COVERAGE_NOT_PRODUCED'
    const foreign = unsupportedProbeVersion(run.events)
    if (foreign !== null) {
      base.reasons.push('PROBE_PROTOCOL_UNSUPPORTED')
      verified.observation = 'UNSUPPORTED'
      why.observation = 'PROBE_PROTOCOL_UNSUPPORTED'
      return { ...base, verdict: 'UNSUPPORTED_PROBE' }
    }
    const obs = observationOf(run)
    if (obs.helloCount === 0 || Object.keys(obs.discovered).length === 0) {
      base.reasons.push('NO_TARGET_MODULE_WRAPPED')
      verified.observation = 'UNSUPPORTED'
      why.observation = 'NO_TARGET_MODULE_WRAPPED'
      return { ...base, verdict: 'UNSUPPORTED_PROBE' }
    }
    if (obs.calls.length > 0) verified.observation = 'VERIFIED'
    if (obs.calls.some((c) => c.outcome.async)) verified.asyncTargets = 'VERIFIED'
    else if (declared.asyncTargets) why.asyncTargets = 'NO_ASYNC_CALL_OBSERVED'
    if (obs.calls.some((c) => c.depth > 0)) base.reasons.push('TRANSITIVE_CALLS_OBSERVED')
    if (verified.observation === 'VERIFIED') {
      const esm = isEsmProject(ctx.root)
      if (esm && declared.esm) verified.esm = 'VERIFIED'
      if (!esm && declared.cjs) verified.cjs = 'VERIFIED'
      // Capacité déclarée mais d'un autre système de modules que ce projet : non exercée ici.
      if (esm && declared.cjs) why.cjs = 'OTHER_MODULE_SYSTEM'
      if (!esm && declared.esm) why.esm = 'OTHER_MODULE_SYSTEM'
    }
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
        const applied = (x: AdapterRun) =>
          x.events.some((e) => e.type === 'MUTATE_CALL' && e.applied === true)
        if (applied(f)) verified.argumentMutation = 'VERIFIED'
        else why.argumentMutation = 'MUTATION_NOT_APPLIED'
        const ran = (f.tests ?? []).filter((t) => t.status !== 'skipped')
        if (f.tests !== null && ran.length === 1 && ran[0]?.testId === m.testId)
          verified.perTestSelection = 'VERIFIED'
        else why.perTestSelection = 'OTHER_TESTS_RAN'
        // Isolation : la mutation s'exécute dans un processus distinct de l'observation et de Varia.
        if (declared.isolatedProcess) {
          const pids = probePids(f)
          const others = new Set([...probePids(run), process.pid])
          if (pids.length === 0) why.isolatedProcess = 'NO_PROBE_PID'
          else if (pids.some((p) => others.has(p))) why.isolatedProcess = 'SAME_PROCESS'
          else verified.isolatedProcess = 'VERIFIED'
        }
        // Parallélisme : deux exécutions simultanées de la même mutation donnent le même résultat.
        if (declared.parallelSafe) {
          const twin = await Promise.all(
            ['p1', 'p2'].map((d) => {
              mkdirSync(join(tmpDir, d), { recursive: true })
              return ctx.adapter.run({
                mode: 'fuzz',
                runDir: join(tmpDir, d),
                timeoutMs: mutationTimeoutMs(ctx, run.process.durationMs),
                testFile: m.testFile,
                testName: m.testName,
                planPath,
                mutationId: m.id,
              })
            }),
          )
          const statuses = (x: AdapterRun) => JSON.stringify((x.tests ?? []).map((t) => t.status))
          if (twin.every((x) => applied(x) && x.tests !== null && statuses(x) === statuses(f)))
            verified.parallelSafe = 'VERIFIED'
          else why.parallelSafe = 'PARALLEL_RESULTS_DIFFER'
        }
      }
    } else if (declared.argumentMutation) why.argumentMutation = 'NO_MUTABLE_INPUT'
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
