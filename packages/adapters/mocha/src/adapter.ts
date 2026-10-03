import type {
  AdapterCapabilities,
  AdapterRun,
  AdapterRunOptions,
  DetectResult,
  PrepareContext,
  TestAdapter,
  TestResult,
} from '@varia/core'
import { globToRegExpSource, runSupervised, statusFileIn, testNodeOptions } from '@varia/core'
import { parseProbeLog, PROBE_ENV, type ProbeEvent } from '@varia/probe-protocol'
import { PROBE_PATH, testIdOf } from '@varia/probe-runtime'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Module chargé par `--require` dans le processus Mocha (crochet de chargement + crochets racine). */
export const REGISTER_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'runtime',
  'register.cjs',
)
/** Crochets de chargement ESM (`module.register`) enregistrés par le fichier de setup. */
export const ESM_HOOKS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'runtime',
  'esm-hooks.mjs',
)
/** Réécriture des exports ESM de l'adapter Vitest (paquet voisin, même mécanisme, réutilisé tel quel). */
export const REWRITE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'vitest',
  'runtime',
  'rewrite.mjs',
)

/** Capacités DÉCLARÉES de l'adapter Mocha (R-01) ; `varia doctor` les vérifie sur le projet. */
export const MOCHA_CAPABILITIES: AdapterCapabilities = {
  observation: true,
  argumentMutation: true,
  perTestSelection: true,
  asyncTargets: true,
  esm: true,
  cjs: true,
  mocks: false,
  testParameters: true,
  // Mocha ne mesure pas la couverture (outil tiers : c8, nyc) : non déclarée.
  coverage: false,
  isolatedProcess: true,
  parallelSafe: false,
}

/** Options de Mocha telles que lues par son `loadOptions` (clés libres). */
export type MochaOptions = Record<string, unknown>

interface MochaJsonTest {
  fullTitle: string
  file?: string
  duration?: number
  err?: Record<string, unknown>
}
interface MochaJson {
  tests: MochaJsonTest[]
  pending: MochaJsonTest[]
}

/**
 * Expression `--grep` qui ne sélectionne QUE ce nom complet : métacaractères échappés, ancrée, et
 * fins de ligne écrites en `\uXXXX` (Mocha lit la chaîne avec `.*`, qui s'arrête à une fin de ligne).
 */
export function exactGrep(name: string): string {
  const escaped = name
    .replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    .replace(/[\n\r\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return `^${escaped}$`
}

/** Lit le rapport du rapporteur JSON de Mocha, avec les mêmes `testId` que la sonde. */
export function parseMochaReport(json: string, root: string): TestResult[] | null {
  let report: MochaJson
  try {
    report = JSON.parse(json) as MochaJson
  } catch {
    return null
  }
  const counts = new Map<string, number>()
  const entry = (t: MochaJsonTest, status: TestResult['status']): TestResult => {
    // Test sans fichier (suite construite par programme) : chemin vide, comme côté sonde.
    const file = t.file === undefined ? '' : relative(root, t.file).split(sep).join('/')
    const key = `${file}\u0000${t.fullTitle}`
    const dup = counts.get(key) ?? 0
    counts.set(key, dup + 1)
    return {
      testId: testIdOf(file, t.fullTitle, dup),
      file,
      name: t.fullTitle,
      status,
      durationMs: t.duration ?? null,
    }
  }
  return [
    ...report.tests.map((t) => entry(t, Object.keys(t.err ?? {}).length > 0 ? 'failed' : 'passed')),
    ...report.pending.map((t) => entry(t, 'skipped')),
  ]
}

/**
 * Configuration Mocha d'UNE exécution, écrite hors du projet : options du projet, puis ce que Varia
 * impose (fichiers, filtre exact, rapporteur JSON vers un fichier, sonde en `--require`, série).
 */
export function mochaRunConfig(
  project: MochaOptions,
  o: { files: string[]; grep: string | null; setupFile: string; reportFile: string },
): MochaOptions {
  const list = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])
  const { _: positional, config: _c, package: _p, ...rest } = project
  void _c
  void _p
  const spec = [...list(positional), ...list(project['spec'])]
  const out: MochaOptions = {
    ...rest,
    require: [...list(project['require']), o.setupFile],
    reporter: 'json',
    'reporter-option': [`output=${o.reportFile}`],
    parallel: false,
    watch: false,
    color: false,
  }
  for (const k of ['reporterOption', 'reporter-options', 'reporterOptions', 'fgrep', 'invert'])
    Reflect.deleteProperty(out, k)
  // Aucun fichier (ni sélectionné ni configuré) : défaut de Mocha (`./test`), jamais une liste vide.
  if (o.files.length > 0 || spec.length > 0) out['spec'] = o.files.length > 0 ? o.files : spec
  else Reflect.deleteProperty(out, 'spec')
  if (o.grep !== null) out['grep'] = o.grep
  else Reflect.deleteProperty(out, 'grep')
  return out
}

export class MochaAdapter implements TestAdapter {
  readonly id = 'mocha'
  private ctx: PrepareContext | null = null
  private options: MochaOptions = {}
  private cli = ''

  capabilities(): AdapterCapabilities {
    return { ...MOCHA_CAPABILITIES }
  }

  async detect(root: string): Promise<DetectResult> {
    const reasons: string[] = []
    let version: string | null = null
    try {
      const req = createRequire(join(root, 'package.json'))
      version = (
        JSON.parse(readFileSync(req.resolve('mocha/package.json'), 'utf8')) as { version: string }
      ).version
    } catch {
      reasons.push('RUNNER_NOT_FOUND')
    }
    // ESM natif pris en charge (crochets `module.register`) : jamais `nativeEsm`.
    return { detected: version !== null, framework: 'mocha', version, nativeEsm: false, reasons }
  }

  async prepare(ctx: PrepareContext): Promise<void> {
    this.ctx = ctx
    const cwd = ctx.cwd ?? ctx.root
    const req = createRequire(join(ctx.root, 'package.json'))
    const mochaDir = dirname(req.resolve('mocha/package.json'))
    this.cli = join(mochaDir, 'lib', 'cli', 'cli.js')
    // Configuration du projet lue par SA copie de Mocha, à partir du répertoire de test (jamais modifiée).
    const { loadOptions } = req(join(mochaDir, 'lib', 'cli', 'options.js')) as {
      loadOptions: (argv: string[]) => MochaOptions
    }
    const { findConfig } = req(join(mochaDir, 'lib', 'cli', 'config.js')) as {
      findConfig: (cwd: string) => string | undefined
    }
    const rc = findConfig(cwd)
    const pkg = join(cwd, 'package.json')
    this.options = loadOptions([
      ...(rc !== undefined ? ['--config', rc] : ['--no-config']),
      ...(existsSync(pkg) ? ['--package', pkg] : ['--no-package']),
    ])
    const pkgFile = join(ctx.root, 'package.json')
    const esm =
      existsSync(pkgFile) &&
      (JSON.parse(readFileSync(pkgFile, 'utf8')) as { type?: unknown }).type === 'module'
    const setup = {
      projectRoot: ctx.root,
      include: ctx.include.map(globToRegExpSource),
      exclude: ctx.exclude.map(globToRegExpSource),
    }
    writeFileSync(
      join(ctx.tmpDir, 'varia-mocha-setup.cjs'),
      [
        "'use strict'",
        `const register = require(${JSON.stringify(REGISTER_PATH)})`,
        `const probe = require(${JSON.stringify(PROBE_PATH)})`,
        // ESM : crochets enregistrés AVANT le chargement des fichiers de test, pour un projet
        // `"type": "module"` seulement (le fil des chargeurs coûte ~100 ms par processus, mesuré).
        ...(esm
          ? [
              `require('module').register(${JSON.stringify(pathToFileURL(ESM_HOOKS_PATH).href)}, { data: ${JSON.stringify({ ...setup, rewritePath: REWRITE_PATH })} })`,
            ]
          : []),
        `module.exports = register.start(require('module'), probe, ${JSON.stringify(setup)}, process)`,
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(ctx.tmpDir, 'targets.json'),
      JSON.stringify({ runId: ctx.runId, projectRoot: ctx.root }),
    )
    writeFileSync(join(ctx.tmpDir, 'redact.json'), JSON.stringify(ctx.redact), { mode: 0o600 })
  }

  async run(o: AdapterRunOptions): Promise<AdapterRun> {
    const ctx = this.ctx
    if (ctx === null) throw new Error('MochaAdapter.prepare() doit être appelé avant run()')
    const reportFile = join(o.runDir, 'mocha-report.json')
    const configFile = join(o.runDir, 'mocharc.json')
    writeFileSync(
      configFile,
      JSON.stringify(
        mochaRunConfig(this.options, {
          files: o.testFile !== undefined ? [join(ctx.root, o.testFile)] : [],
          grep: o.testName !== undefined ? exactGrep(o.testName) : null,
          setupFile: join(ctx.tmpDir, 'varia-mocha-setup.cjs'),
          reportFile,
        }),
      ),
    )
    const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
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
      [this.cli, '--config', configFile, '--no-package'],
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
    // Processus tué ou mort avant la fin : aucun rapport (ou un rapport d'une exécution incomplète).
    const tests =
      proc.timedOut || !existsSync(reportFile)
        ? null
        : parseMochaReport(readFileSync(reportFile, 'utf8'), ctx.root)
    return { process: proc, tests, events, truncatedLines, invalidLines }
  }
}
