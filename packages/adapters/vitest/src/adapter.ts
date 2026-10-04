import type {
  AdapterCapabilities,
  AdapterRun,
  AdapterRunOptions,
  DetectResult,
  PrepareContext,
  TestAdapter,
  TestResult,
} from '@varia/core'
import {
  globToRegExpSource,
  parseCoverageSummary,
  runSupervised,
  statusFileIn,
  testNodeOptions,
  testPaths,
} from '@varia/core'
import { parseProbeLog, PROBE_ENV, type ProbeEvent } from '@varia/probe-protocol'
import { PROBE_PATH, testIdOf } from '@varia/probe-runtime'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const runtimeDir = () =>
  [resolve(HERE, '..', 'runtime'), resolve(HERE, '..', '..', 'runtime')].find((d) =>
    existsSync(join(d, 'run-vitest.mjs')),
  ) ?? resolve(HERE, '..', 'runtime')

/** Capacités DÉCLARÉES de l'adapter Vitest (J2) ; `varia doctor` les vérifie sur le projet. */
export const VITEST_CAPABILITIES: AdapterCapabilities = {
  observation: true,
  argumentMutation: true,
  perTestSelection: true,
  asyncTargets: true,
  esm: true,
  cjs: false,
  mocks: false,
  testParameters: true,
  coverage: true,
  isolatedProcess: true,
  parallelSafe: false,
}

const CONFIG_FILES = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs',
]
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

interface VitestJson {
  testResults: {
    name: string
    assertionResults: { fullName: string; status: string; duration?: number | null }[]
  }[]
}

/** Résout une entrée du champ `exports` (chaîne ou conditions imbriquées `import` / `default`). */
export function exportEntry(e: unknown): string {
  if (typeof e === 'string') return e
  if (e !== null && typeof e === 'object') {
    const o = e as Record<string, unknown>
    return exportEntry(o['import'] ?? o['default'])
  }
  throw new Error('entrée exports introuvable')
}

/** Lit la sortie `json` de Vitest (stdout) avec les mêmes `testId` que la sonde. */
export function parseVitestReport(stdout: string, root: string): TestResult[] | null {
  const start = stdout.indexOf('{"')
  if (start < 0) return null
  let report: VitestJson
  try {
    report = JSON.parse(stdout.slice(start, stdout.lastIndexOf('}') + 1)) as VitestJson
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
          : a.status === 'skipped' || a.status === 'pending' || a.status === 'todo'
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

export class VitestAdapter implements TestAdapter {
  readonly id = 'vitest'
  private ctx: PrepareContext | null = null

  capabilities(): AdapterCapabilities {
    return { ...VITEST_CAPABILITIES }
  }

  async detect(root: string): Promise<DetectResult> {
    try {
      const req = createRequire(join(root, 'package.json'))
      const version = (
        JSON.parse(readFileSync(req.resolve('vitest/package.json'), 'utf8')) as { version: string }
      ).version
      return { detected: true, framework: 'vitest', version, nativeEsm: false, reasons: [] }
    } catch {
      return {
        detected: false,
        framework: 'vitest',
        version: null,
        nativeEsm: false,
        reasons: ['RUNNER_NOT_FOUND'],
      }
    }
  }

  async prepare(ctx: PrepareContext): Promise<void> {
    this.ctx = ctx
    const req = createRequire(join(ctx.root, 'package.json'))
    const pkgPath = req.resolve('vitest/package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { exports: Record<string, unknown> }
    const entry = join(dirname(pkgPath), exportEntry(pkg.exports['.']))
    // Le setup importe la copie de Vitest DU PROJET (même instance que les tests) et branche la sonde.
    writeFileSync(
      join(ctx.tmpDir, 'varia-setup.mjs'),
      [
        `import { afterEach, beforeEach, expect } from ${JSON.stringify(pathToFileURL(entry).href)}`,
        `import { createRequire } from 'node:module'`,
        `const probe = createRequire(import.meta.url)(${JSON.stringify(PROBE_PATH)})`,
        `probe.install({ beforeEach, afterEach, getState: () => expect.getState(), nameOf: (s) => String(s.currentTestName ?? '').split(' > ').join(' '), process })`,
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(ctx.tmpDir, 'targets.json'),
      JSON.stringify({ runId: ctx.runId, projectRoot: ctx.root }),
    )
    writeFileSync(join(ctx.tmpDir, 'redact.json'), JSON.stringify(ctx.redact), { mode: 0o600 })
  }

  private coverageProvider(root: string): boolean {
    try {
      createRequire(join(root, 'package.json')).resolve('@vitest/coverage-v8/package.json')
      return true
    } catch {
      return false
    }
  }

  async run(o: AdapterRunOptions): Promise<AdapterRun> {
    const ctx = this.ctx
    if (ctx === null) throw new Error('VitestAdapter.prepare() doit être appelé avant run()')
    const params = {
      root: ctx.root,
      configFile: CONFIG_FILES.map((f) => join(ctx.root, f)).find((f) => existsSync(f)) ?? null,
      files: o.testFile !== undefined ? [join(ctx.root, o.testFile)] : testPaths(ctx),
      testNamePattern: o.testName !== undefined ? `^${escapeRegExp(o.testName)}$` : null,
      include: ctx.include.map(globToRegExpSource),
      exclude: ctx.exclude.map(globToRegExpSource),
      cacheDir: join(ctx.tmpDir, 'vite-cache'),
      setupFile: join(ctx.tmpDir, 'varia-setup.mjs'),
      // Couverture seulement si le fournisseur v8 est installé dans le projet (sinon : non disponible).
      coverageDir:
        o.coverage === true && this.coverageProvider(ctx.root) ? join(o.runDir, 'coverage') : null,
      coverageInclude: ctx.include,
    }
    const paramsFile = join(o.runDir, 'vitest-params.json')
    writeFileSync(paramsFile, JSON.stringify(params))
    const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' }
    for (const k of Object.keys(env)) if (k.startsWith('VARIA_')) Reflect.deleteProperty(env, k)
    // Environnement de test du projet (`test.env`), puis celui de l'exécution (reset), puis la sonde.
    Object.assign(env, ctx.env ?? {}, o.env ?? {})
    const nodeOptions = testNodeOptions(env['NODE_OPTIONS'], ctx)
    if (nodeOptions !== undefined) env['NODE_OPTIONS'] = nodeOptions
    Object.assign(env, {
      [PROBE_ENV.mode]: o.mode,
      [PROBE_ENV.runDir]: o.runDir,
      [PROBE_ENV.targets]: join(ctx.tmpDir, 'targets.json'),
      [PROBE_ENV.redact]: join(ctx.tmpDir, 'redact.json'),
      ...(o.planPath !== undefined ? { [PROBE_ENV.plan]: o.planPath } : {}),
      ...(o.mutationId !== undefined ? { [PROBE_ENV.mutationId]: o.mutationId } : {}),
    })
    const proc = await runSupervised(
      process.execPath,
      [join(runtimeDir(), 'run-vitest.mjs'), paramsFile],
      {
        cwd: ctx.cwd ?? ctx.root,
        env,
        timeoutMs: o.timeoutMs,
        statusFile: statusFileIn(o.runDir),
        ...(o.maxOutputBytes !== undefined ? { maxOutputBytes: o.maxOutputBytes } : {}),
      },
    )
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
    const summary = join(o.runDir, 'coverage', 'coverage-summary.json')
    const coverage = existsSync(summary)
      ? parseCoverageSummary(readFileSync(summary, 'utf8'), ctx.root, (f) =>
          relative(ctx.root, f).split(sep).join('/'),
        )
      : undefined
    return {
      process: proc,
      tests: proc.timedOut ? null : parseVitestReport(proc.stdout, ctx.root),
      events,
      truncatedLines,
      invalidLines,
      ...(coverage !== undefined ? { coverage } : {}),
    }
  }
}
