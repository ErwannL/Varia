// Suite de conformité d'adapter (CDC §9.3) : un adapter RÉEL, piloté par le moteur RÉEL, sur un projet
// jetable construit à partir d'un projet d'exemple (son runner installé) et des fichiers de conformité.
import {
  diffSnapshots,
  manifestSnapshot,
  type AdapterRun,
  type TestAdapter,
  type TestResult,
} from '@varia/core'
import {
  EngineContext,
  newRunId,
  planRun,
  prepareContext,
  runBaseline,
  runFuzz,
} from '@varia/engine'
import type { ProbeEvent } from '@varia/probe-protocol'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { conformanceFiles, TESTS, type ConformanceDialect } from './fixture.js'

export const CHECKS = [
  'baseline',
  'observation',
  'async',
  'multipleCalls',
  'exception',
  'parameterized',
  'selection',
  'mutation',
  'cleanup',
] as const
export type CheckId = (typeof CHECKS)[number]

/** `UNVERIFIED` : vérification impossible ici (dite, jamais simulée). */
export interface CheckResult {
  id: CheckId
  status: 'PASS' | 'FAIL' | 'UNVERIFIED'
  detail: string
}

export interface ConformanceReport {
  adapter: string
  passed: boolean
  checks: CheckResult[]
}

export interface ConformanceOptions {
  adapter: TestAdapter
  /** Projet d'exemple dont le runner est installé (`node_modules`) ; jamais modifié. */
  example: string
  dialect: ConformanceDialect
  /** Délai par processus de test (large : aucune vérification ne dépend de la vitesse). */
  timeoutMs?: number
  /** Lignes de commande des processus vivants ; `null` si la plateforme ne permet pas de les lister. */
  listProcesses?: () => string[] | null
}

/** Processus vivants via `ps` (POSIX) ; `null` sous Windows (non vérifié, dit comme tel). */
export function systemProcesses(platform: NodeJS.Platform = process.platform): string[] | null {
  if (platform === 'win32') return null
  return execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' }).split('\n')
}

/** Projet jetable : fichiers de premier niveau de l'exemple, `node_modules` lié, fichiers de conformité. */
export function buildProject(example: string, dialect: ConformanceDialect): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'varia-conformance-')))
  for (const e of readdirSync(example, { withFileTypes: true }))
    if (e.isFile()) copyFileSync(join(example, e.name), join(root, e.name))
  symlinkSync(join(example, 'node_modules'), join(root, 'node_modules'), 'junction')
  for (const [rel, content] of Object.entries(conformanceFiles(dialect))) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  return root
}

const CONFIG = [
  'version: 1',
  'project: { name: adapter-conformance }',
  "targets: { mode: auto, include: ['src/**'] }",
  'mutations: { mode: normal, seed: 1 }',
  'execution: { timeout_ms: 60000 }',
  'oracle: { slow_floor_ms: 3600000 }',
].join('\n')

const calls = (run: AdapterRun, exp: string) =>
  run.events.filter((e) => e.type === 'OBSERVE_CALL' && e.export === exp)
/** Issues (`TARGET_*`) des appels observés d'un export, reliées par `callId`. */
const issues = (run: AdapterRun, type: ProbeEvent['type'], exp: string) => {
  const ids = new Set(calls(run, exp).map((c) => c.callId))
  return run.events.filter((e) => e.type === type && ids.has(e.callId))
}
/** Résultats de tests ; aucun si le runner n'en a produit (processus mort). */
const testsOf = (run: AdapterRun | null): TestResult[] => run?.tests ?? []
const executed = (run: AdapterRun) =>
  testsOf(run).filter((t) => t.status === 'passed' || t.status === 'failed')
const passedNames = (run: AdapterRun) =>
  testsOf(run)
    .filter((t) => t.status === 'passed')
    .map((t) => t.name)
const show = (v: unknown) => JSON.stringify(v)

/**
 * Exécute la suite. Les vérifications sont regroupées par exécution ; une exception pendant un groupe
 * fait échouer tout le groupe (son détail la cite).
 */
export async function runConformance(o: ConformanceOptions): Promise<ConformanceReport> {
  const results = new Map<CheckId, CheckResult>()
  const record = (id: CheckId, ok: boolean, detail: string) =>
    results.set(id, { id, status: ok ? 'PASS' : 'FAIL', detail })
  const attempt = async (ids: CheckId[], fn: () => Promise<void> | void) => {
    try {
      await fn()
    } catch (e) {
      for (const id of ids) record(id, false, `exception : ${String(e)}`)
    }
  }
  const timeoutMs = o.timeoutMs ?? 120_000
  const root = buildProject(o.example, o.dialect)
  const work = mkdtempSync(join(tmpdir(), 'varia-conformance-data-'))
  const configFile = join(work, 'varia.yml')
  writeFileSync(configFile, CONFIG)
  const dir = (name: string) => {
    const p = join(work, name)
    mkdirSync(p, { recursive: true })
    return p
  }
  const before = manifestSnapshot(root)
  const ctx = new EngineContext({
    root,
    adapter: o.adapter,
    dataDir: join(work, 'data'),
    configFile,
  })
  const runId = newRunId()
  let observed: AdapterRun | null = null
  try {
    // Moteur : baseline (observation, stabilité, intégrité du projet).
    await attempt(['baseline'], async () => {
      const b = await runBaseline(ctx)
      record(
        'baseline',
        b.state === 'BASELINE_DONE',
        `${b.state} ; ${String(b.passed)}/${String(b.tests)}`,
      )
    })
    // Adapter : une exécution d'observation de tout le projet, lue événement par événement.
    await attempt(
      ['observation', 'async', 'multipleCalls', 'exception', 'parameterized'],
      async () => {
        await o.adapter.prepare(prepareContext(ctx, runId, dir('observe')))
        const run = await o.adapter.run({ mode: 'observe', runDir: dir('observe-run'), timeoutMs })
        observed = run
        const greet = calls(run, 'greet')
        record(
          'observation',
          greet.length === 1 && show(greet[0]?.args) === show([{ name: 'Ada' }]),
          `greet : ${show(greet.map((c) => c.args))}`,
        )
        const ret = issues(run, 'TARGET_RETURN', 'fetchLater')
        record(
          'async',
          calls(run, 'fetchLater').length === 1 &&
            ret.length === 1 &&
            ret[0]?.async === true &&
            show(ret[0]?.value) === show({ id: 7 }),
          `fetchLater : ${show(ret.map((r) => r.value))}`,
        )
        const seq = calls(run, 'add').map((c) => c.sequence)
        record('multipleCalls', show(seq) === show([0, 1, 2]), `rangs de add : ${show(seq)}`)
        const thrown = issues(run, 'TARGET_THROW', 'fail')
        const chain = thrown[0]?.error?.constructorChain
        record(
          'exception',
          thrown.length === 1 && chain?.[0] === 'ConformanceError' && chain.includes('Error'),
          `TARGET_THROW : ${String(thrown.length)}, chaîne ${show(chain)}`,
        )
        const doubles = calls(run, 'double')
        const names = passedNames(run)
        record(
          'parameterized',
          names.includes(TESTS.param(1)) &&
            names.includes(TESTS.param(2)) &&
            show(doubles.map((c) => c.args)) === show([[1], [2]]) &&
            new Set(doubles.map((c) => c.testId)).size === 2,
          `tests : ${show(names)} ; double : ${show(doubles.map((c) => c.args))}`,
        )
      },
    )
    // Sélection : un seul test exécuté, et seules ses cibles observées.
    await attempt(['selection'], async () => {
      const file = testsOf(observed as AdapterRun | null).find(
        (t) => t.name === TESTS.observe,
      )?.file
      if (file === undefined) throw new Error('test de conformité introuvable')
      const run = await o.adapter.run({
        mode: 'observe',
        runDir: dir('selection-run'),
        timeoutMs,
        testFile: file,
        testName: TESTS.observe,
      })
      const ran = executed(run).map((t) => t.name)
      const exports = [
        ...new Set(run.events.filter((e) => e.type === 'OBSERVE_CALL').map((e) => e.export)),
      ]
      record(
        'selection',
        show(ran) === show([TESTS.observe]) && show(exports) === show(['greet']),
        `exécutés : ${show(ran)} ; cibles : ${show(exports)}`,
      )
    })
    // Moteur : plan sur un chemin (`greet#arg0.name`), fuzz ; une mutation non appliquée est SKIPPED.
    await attempt(['mutation'], async () => {
      const plan = planRun(ctx, ctx.reader.latestRun(ctx.projectId)?.id ?? '', {
        maxMutations: 3,
        filters: { functions: ['greet'], tests: [TESTS.observe] },
      })
      const r = await runFuzz(ctx, plan.runId)
      const statuses = ctx.reader.results(plan.runId).map((x) => `${x.status}:${String(x.reason)}`)
      record(
        'mutation',
        r.executed > 0 &&
          statuses.length === r.executed &&
          statuses.every((s) => !s.startsWith('SKIPPED') && !s.startsWith('INFRA_ERROR')),
        `résultats : ${show(statuses)}`,
      )
    })
    // Nettoyage : projet intact (aucun fichier ajouté ni modifié), aucun processus du run survivant.
    await attempt(['cleanup'], () => {
      const diff = diffSnapshots(before, manifestSnapshot(root))
      const procs = (o.listProcesses ?? systemProcesses)()
      const runIds = ctx.reader
        .listRuns()
        .map((r) => r.id)
        .concat(runId)
      const alive = procs?.filter((l) => runIds.some((id) => l.includes(id))) ?? []
      if (diff.length === 0 && procs === null)
        results.set('cleanup', {
          id: 'cleanup',
          status: 'UNVERIFIED',
          detail: 'projet intact ; processus non listables sur cette plateforme',
        })
      else
        record(
          'cleanup',
          diff.length === 0 && alive.length === 0,
          `diff : ${show(diff)} ; vivants : ${show(alive)}`,
        )
    })
  } finally {
    ctx.close()
    rmSync(work, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
  const checks = CHECKS.map((id) => results.get(id) as CheckResult)
  return { adapter: o.adapter.id, passed: checks.every((c) => c.status !== 'FAIL'), checks }
}
