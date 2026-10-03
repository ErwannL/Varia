import type {
  AdapterCapabilities,
  AdapterRun,
  AdapterRunOptions,
  DetectResult,
  PrepareContext,
  TestAdapter,
  TestResult,
} from '@varia/core'
import { globToRegExpSource, runSupervised, statusFileIn } from '@varia/core'
import { parseProbeLog, PROBE_ENV, type ProbeEvent } from '@varia/probe-protocol'
import { testIdOf } from '@varia/probe-runtime'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Dossier ajouté au PYTHONPATH du processus de test : il contient le paquet `varia_probe`. */
export const PY_RUNTIME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'runtime')

/** Variables propres au plugin pytest (en plus de celles de la norme, `PROBE_ENV`). */
export const PYTEST_ENV = {
  setup: 'VARIA_PYTEST_SETUP',
  report: 'VARIA_PYTEST_REPORT',
  select: 'VARIA_PYTEST_SELECT',
} as const

/** Capacités DÉCLARÉES de l'adapter pytest (R-02) ; `varia doctor` les vérifie sur le projet. */
export const PYTEST_CAPABILITIES: AdapterCapabilities = {
  observation: true,
  argumentMutation: true,
  perTestSelection: true,
  asyncTargets: true,
  // Systèmes de modules JavaScript : sans objet en Python.
  esm: false,
  cjs: false,
  mocks: false,
  testParameters: true,
  // pytest ne mesure pas la couverture (extension tierce pytest-cov) : non déclarée.
  coverage: false,
  isolatedProcess: true,
  parallelSafe: false,
}

/**
 * Interpréteur Python du projet : environnement virtuel `.venv` puis `venv` à la racine, sinon celui
 * du PATH (`python3`, `python` sous Windows). Plateforme et test d'existence injectés.
 */
export function resolvePython(
  root: string,
  platform: NodeJS.Platform = process.platform,
  exists: (p: string) => boolean = existsSync,
): string {
  const win = platform === 'win32'
  for (const venv of ['.venv', 'venv']) {
    const candidate = win
      ? join(root, venv, 'Scripts', 'python.exe')
      : join(root, venv, 'bin', 'python')
    if (exists(candidate)) return candidate
  }
  return win ? 'python' : 'python3'
}

/** PYTHONPATH du processus de test : la sonde d'abord, puis celui hérité. */
export function pythonPath(inherited: string | undefined): string {
  return inherited !== undefined && inherited !== ''
    ? `${PY_RUNTIME_DIR}${delimiter}${inherited}`
    : PY_RUNTIME_DIR
}

interface PytestReport {
  tests: { file: string; name: string; status: TestResult['status']; durationMs: number }[]
}

/** Lit le rapport écrit par le plugin, avec les mêmes `testId` que la sonde. */
export function parsePytestReport(json: string): TestResult[] | null {
  let report: PytestReport
  try {
    report = JSON.parse(json) as PytestReport
  } catch {
    return null
  }
  const counts = new Map<string, number>()
  return report.tests.map((t) => {
    const key = `${t.file}\u0000${t.name}`
    const dup = counts.get(key) ?? 0
    counts.set(key, dup + 1)
    return {
      testId: testIdOf(t.file, t.name, dup),
      file: t.file,
      name: t.name,
      status: t.status,
      durationMs: t.durationMs,
    }
  })
}

type Exec = (cmd: string, args: string[], cwd: string) => string

const defaultExec: Exec = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

export class PytestAdapter implements TestAdapter {
  readonly id = 'pytest'
  private ctx: PrepareContext | null = null
  private python = ''

  constructor(private readonly exec: Exec = defaultExec) {}

  capabilities(): AdapterCapabilities {
    return { ...PYTEST_CAPABILITIES }
  }

  async detect(root: string): Promise<DetectResult> {
    const reasons: string[] = []
    let version: string | null = null
    try {
      version = this.exec(
        resolvePython(root),
        ['-c', 'import pytest; print(pytest.__version__)'],
        root,
      ).trim()
    } catch {
      reasons.push('RUNNER_NOT_FOUND')
    }
    return { detected: version !== null, framework: 'pytest', version, nativeEsm: false, reasons }
  }

  async prepare(ctx: PrepareContext): Promise<void> {
    this.ctx = ctx
    this.python = resolvePython(ctx.root)
    writeFileSync(
      join(ctx.tmpDir, 'varia-pytest.json'),
      JSON.stringify({
        projectRoot: ctx.root,
        include: ctx.include.map(globToRegExpSource),
        exclude: ctx.exclude.map(globToRegExpSource),
      }),
    )
    writeFileSync(
      join(ctx.tmpDir, 'targets.json'),
      JSON.stringify({ runId: ctx.runId, projectRoot: ctx.root }),
    )
    writeFileSync(join(ctx.tmpDir, 'redact.json'), JSON.stringify(ctx.redact), { mode: 0o600 })
  }

  async run(o: AdapterRunOptions): Promise<AdapterRun> {
    const ctx = this.ctx
    if (ctx === null) throw new Error('PytestAdapter.prepare() doit être appelé avant run()')
    const reportFile = join(o.runDir, 'pytest-report.json')
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' }
    for (const k of Object.keys(env)) if (k.startsWith('VARIA_')) Reflect.deleteProperty(env, k)
    // Environnement de test du projet (`test.env`), puis celui de l'exécution (reset), puis la sonde.
    Object.assign(env, ctx.env ?? {}, o.env ?? {})
    Object.assign(env, {
      PYTHONPATH: pythonPath(env['PYTHONPATH']),
      // Aucun fichier compilé écrit : ni `__pycache__` dans le projet, ni copie compilée des sources
      // (littéraux sensibles compris) dans le dossier du run.
      PYTHONDONTWRITEBYTECODE: '1',
      [PROBE_ENV.mode]: o.mode,
      [PROBE_ENV.runDir]: o.runDir,
      [PROBE_ENV.targets]: join(ctx.tmpDir, 'targets.json'),
      [PROBE_ENV.redact]: join(ctx.tmpDir, 'redact.json'),
      [PYTEST_ENV.setup]: join(ctx.tmpDir, 'varia-pytest.json'),
      [PYTEST_ENV.report]: reportFile,
      ...(o.testName !== undefined ? { [PYTEST_ENV.select]: o.testName } : {}),
      ...(o.planPath !== undefined ? { [PROBE_ENV.plan]: o.planPath } : {}),
      ...(o.mutationId !== undefined ? { [PROBE_ENV.mutationId]: o.mutationId } : {}),
    })
    const args = [
      '-m',
      'pytest',
      '-p',
      'varia_probe.plugin',
      // Aucun `.pytest_cache` écrit dans le projet.
      '-p',
      'no:cacheprovider',
      '-q',
      ...(o.testFile !== undefined ? [join(ctx.root, o.testFile)] : []),
    ]
    const proc = await runSupervised(this.python, args, {
      cwd: ctx.cwd ?? ctx.root,
      env,
      timeoutMs: o.timeoutMs,
      statusFile: statusFileIn(o.runDir),
      ...(o.maxOutputBytes !== undefined ? { maxOutputBytes: o.maxOutputBytes } : {}),
    })
    const events: ProbeEvent[] = []
    let truncatedLines = 0
    let invalidLines = 0
    for (const f of readdirSync(o.runDir)
      .filter((n) => /^probe-\d+\.jsonl$/.test(n))
      .sort()) {
      const parsed = parseProbeLog(readFileSync(join(o.runDir, f), 'utf8'))
      events.push(...parsed.events)
      truncatedLines += parsed.truncatedLines
      invalidLines += parsed.invalidLines
    }
    // Processus tué ou mort avant la fin de session (os._exit) : aucun rapport.
    const tests =
      proc.timedOut || !existsSync(reportFile)
        ? null
        : parsePytestReport(readFileSync(reportFile, 'utf8'))
    return { process: proc, tests, events, truncatedLines, invalidLines }
  }
}
