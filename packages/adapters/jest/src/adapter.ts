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
import { PROBE_PATH, testIdOf } from '@varia/probe-runtime'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateJestConfig, loadProjectJestConfig, resolveJestBin } from './config.js'

export const TRANSFORM_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'runtime',
  'transform.cjs',
)
const TRANSFORM_PATH_SRC = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'runtime',
  'transform.cjs',
)
const transformPath = () => (existsSync(TRANSFORM_PATH_SRC) ? TRANSFORM_PATH_SRC : TRANSFORM_PATH)

interface JestAssertion {
  fullName: string
  status: string
  duration?: number | null
}
interface JestReport {
  testResults: { name: string; assertionResults: JestAssertion[] }[]
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Capacités DÉCLARÉES de l'adapter Jest en J1 (vérifiées par `varia doctor`, cf. J0). */
export const JEST_CAPABILITIES: AdapterCapabilities = {
  observation: true,
  argumentMutation: true,
  perTestSelection: true,
  asyncTargets: true,
  esm: false,
  cjs: true,
  mocks: false,
  testParameters: true,
  coverage: false,
  isolatedProcess: true,
  parallelSafe: false,
}

function readPackage(root: string): Record<string, unknown> | null {
  const p = join(root, 'package.json')
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>) : null
}

/** Lit la sortie `--json` de Jest (stdout) : aucun fichier de sortie n'est écrit sur disque. */
export function parseJestReport(stdout: string, root: string): TestResult[] | null {
  const start = stdout.indexOf('{"')
  if (start < 0) return null
  let report: JestReport
  try {
    report = JSON.parse(stdout.slice(start)) as JestReport
  } catch {
    return null
  }
  const out: TestResult[] = []
  for (const file of report.testResults) {
    const rel = relative(root, file.name).split(sep).join('/')
    const counts = new Map<string, number>()
    for (const a of file.assertionResults) {
      const dup = counts.get(a.fullName) ?? 0
      counts.set(a.fullName, dup + 1)
      const status =
        a.status === 'passed' || a.status === 'failed'
          ? a.status
          : a.status === 'pending' || a.status === 'skipped' || a.status === 'todo'
            ? 'skipped'
            : 'other'
      out.push({
        testId: testIdOf(rel, a.fullName, dup),
        file: rel,
        name: a.fullName,
        status,
        durationMs: a.duration ?? null,
      })
    }
  }
  return out
}

export class JestAdapter implements TestAdapter {
  readonly id = 'jest'
  private ctx: PrepareContext | null = null
  private configPath = ''

  capabilities(): AdapterCapabilities {
    return { ...JEST_CAPABILITIES }
  }

  async detect(root: string): Promise<DetectResult> {
    const pkg = readPackage(root)
    const reasons: string[] = []
    let version: string | null = null
    try {
      const req = createRequire(join(root, 'package.json'))
      version = (
        JSON.parse(readFileSync(req.resolve('jest/package.json'), 'utf8')) as { version: string }
      ).version
    } catch {
      reasons.push('RUNNER_NOT_FOUND')
    }
    const config = pkg ? await loadProjectJestConfig(root).catch(() => null) : null
    const babel = [
      '.babelrc',
      '.babelrc.js',
      '.babelrc.json',
      'babel.config.js',
      'babel.config.cjs',
      'babel.config.json',
    ].some((f) => existsSync(join(root, f)))
    const transformsSources =
      config !== null &&
      (config['transform'] !== undefined
        ? Object.keys(config['transform'] as object).length > 0
        : true)
    const nativeEsm =
      pkg?.['type'] === 'module' &&
      !(babel && transformsSources) &&
      !(config !== null && JSON.stringify(config['transform'] ?? {}).includes('ts-jest'))
    if (nativeEsm) reasons.push('NATIVE_ESM')
    return { detected: version !== null, framework: 'jest', version, nativeEsm, reasons }
  }

  async prepare(ctx: PrepareContext): Promise<void> {
    this.ctx = ctx
    const project = await loadProjectJestConfig(ctx.root)
    const config = generateJestConfig({
      root: ctx.root,
      project,
      transformPath: transformPath(),
      probePath: PROBE_PATH,
      include: ctx.include.map(globToRegExpSource),
      exclude: ctx.exclude.map(globToRegExpSource),
      cacheDirectory: join(ctx.tmpDir, 'jest-cache'),
      salt: ctx.runId,
    })
    this.configPath = join(ctx.tmpDir, 'jest.config.json')
    writeFileSync(this.configPath, JSON.stringify(config, null, 2))
    writeFileSync(
      join(ctx.tmpDir, 'targets.json'),
      JSON.stringify({ runId: ctx.runId, projectRoot: ctx.root }),
    )
    writeFileSync(join(ctx.tmpDir, 'redact.json'), JSON.stringify(ctx.redact), { mode: 0o600 })
  }

  async run(o: AdapterRunOptions): Promise<AdapterRun> {
    const ctx = this.ctx
    if (ctx === null) throw new Error('JestAdapter.prepare() doit être appelé avant run()')
    const args = [
      resolveJestBin(ctx.root),
      '--config',
      this.configPath,
      '--runInBand',
      '--ci',
      '--json',
      '--colors=false',
      '--watchman=false',
      '--coverage=false',
    ]
    if (o.testFile !== undefined) args.push('--runTestsByPath', join(ctx.root, o.testFile))
    if (o.testName !== undefined) args.push('--testNamePattern', `^${escapeRegExp(o.testName)}$`)
    const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    for (const k of Object.keys(env)) if (k.startsWith('VARIA_')) Reflect.deleteProperty(env, k)
    if (ctx.nodeOptions !== undefined)
      env['NODE_OPTIONS'] = `${env['NODE_OPTIONS'] ?? ''} ${ctx.nodeOptions}`.trim()
    Object.assign(env, {
      [PROBE_ENV.mode]: o.mode,
      [PROBE_ENV.runDir]: o.runDir,
      [PROBE_ENV.targets]: join(ctx.tmpDir, 'targets.json'),
      [PROBE_ENV.redact]: join(ctx.tmpDir, 'redact.json'),
      ...(o.planPath !== undefined ? { [PROBE_ENV.plan]: o.planPath } : {}),
      ...(o.mutationId !== undefined ? { [PROBE_ENV.mutationId]: o.mutationId } : {}),
    })
    const proc = await runSupervised(process.execPath, args, {
      cwd: ctx.root,
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
    return {
      process: proc,
      tests: proc.timedOut ? null : parseJestReport(proc.stdout, ctx.root),
      events,
      truncatedLines,
      invalidLines,
    }
  }
}
