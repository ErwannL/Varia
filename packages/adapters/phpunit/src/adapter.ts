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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Bootstrap PHP de la sonde (`--bootstrap`), fourni avec Varia : rien n'est installé dans le projet. */
export const BOOTSTRAP_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'runtime',
  'bootstrap.php',
)
/** Extension PHPUnit de la sonde (`--extension`), chargée par le bootstrap. */
export const EXTENSION_CLASS = 'Varia\\Probe\\Extension'

/**
 * Capacités DÉCLARÉES de l'adapter PHPUnit (R-03) ; `varia doctor` les vérifie. PHP est synchrone (pas
 * de promesses dans le langage) et n'a ni ESM ni CommonJS : `asyncTargets`, `esm`, `cjs` non déclarés.
 */
export const PHPUNIT_CAPABILITIES: AdapterCapabilities = {
  observation: true,
  argumentMutation: true,
  perTestSelection: true,
  asyncTargets: false,
  esm: false,
  cjs: false,
  mocks: false,
  testParameters: true,
  // Couverture PHPUnit (pcov/xdebug) non reliée au rapport de Varia : non déclarée.
  coverage: false,
  isolatedProcess: true,
  parallelSafe: false,
}

/** Test listé par l'extension en mode liste : fichier absolu, nom (TestDox), motif `--filter` échappé. */
export interface ListedTest {
  file: string
  name: string
  filter: string
}

interface PhpResult {
  file: string
  name: string
  status: string
  durationMs: number
}

/** Fichiers de configuration PHPUnit, dans l'ordre de recherche de PHPUnit 11. */
const CONFIG_FILES = ['phpunit.xml', 'phpunit.dist.xml', 'phpunit.xml.dist']

/**
 * Bootstrap du projet (attribut `bootstrap` de sa configuration PHPUnit, relatif à celle-ci), sinon
 * `vendor/autoload.php` ; `null` si aucun. Il est chargé par le bootstrap de Varia (qui le remplace).
 */
export function projectBootstrap(cwd: string): string | null {
  for (const name of CONFIG_FILES) {
    const file = join(cwd, name)
    if (!existsSync(file)) continue
    const m = /<phpunit\b[^>]*\sbootstrap\s*=\s*"([^"]*)"/s.exec(readFileSync(file, 'utf8'))
    if (m?.[1] !== undefined) return isAbsolute(m[1]) ? m[1] : join(cwd, m[1])
    break
  }
  const autoload = join(cwd, 'vendor', 'autoload.php')
  return existsSync(autoload) ? autoload : null
}

/** Version de phpunit/phpunit installée (`vendor/composer/installed.json`), `null` si absente. */
export function installedPhpunit(root: string): string | null {
  try {
    const data = JSON.parse(
      readFileSync(join(root, 'vendor', 'composer', 'installed.json'), 'utf8'),
    ) as { packages?: { name: string; version: string }[] }
    const p = (data.packages ?? []).find((x) => x.name === 'phpunit/phpunit')
    return p === undefined ? null : p.version.replace(/^v/, '')
  } catch {
    return null
  }
}

/** Résultats écrits par l'extension en fin d'exécution, avec les mêmes `testId` que la sonde. */
export function parseResults(json: string, root: string): TestResult[] | null {
  let rows: PhpResult[]
  try {
    rows = JSON.parse(json) as PhpResult[]
  } catch {
    return null
  }
  const counts = new Map<string, number>()
  return rows.map((r) => {
    const file = relative(root, r.file).split(sep).join('/')
    const key = `${file}\u0000${r.name}`
    const dup = counts.get(key) ?? 0
    counts.set(key, dup + 1)
    const status: TestResult['status'] =
      r.status === 'passed' || r.status === 'failed' || r.status === 'skipped' ? r.status : 'other'
    return {
      testId: testIdOf(file, r.name, dup),
      file,
      name: r.name,
      status,
      durationMs: r.durationMs,
    }
  })
}

/** Motif `--filter` qui ne sélectionne QUE les tests de ce fichier et de ce nom (TestDox). */
export function exactFilter(list: ListedTest[], root: string, file: string, name: string): string {
  const ids = list
    .filter((t) => relative(root, t.file).split(sep).join('/') === file && t.name === name)
    .map((t) => t.filter)
  // Aucun test de ce nom : motif qui ne correspond à rien (aucun test exécuté, jamais tous).
  return ids.length === 0 ? '/(?!)/' : `/^(?:${ids.join('|')})$/`
}

export interface PhpunitAdapterOptions {
  /** Interpréteur PHP (défaut : `php` du PATH). */
  php?: string
}

export class PhpunitAdapter implements TestAdapter {
  readonly id = 'phpunit'
  private ctx: PrepareContext | null = null
  private list: ListedTest[] | null = null
  private readonly php: string

  constructor(o: PhpunitAdapterOptions = {}) {
    this.php = o.php ?? 'php'
  }

  capabilities(): AdapterCapabilities {
    return { ...PHPUNIT_CAPABILITIES }
  }

  async detect(root: string): Promise<DetectResult> {
    const version = installedPhpunit(root)
    return {
      detected: version !== null,
      framework: 'phpunit',
      version,
      nativeEsm: false,
      reasons: version === null ? ['RUNNER_NOT_FOUND'] : [],
    }
  }

  async prepare(ctx: PrepareContext): Promise<void> {
    this.ctx = ctx
    this.list = null
    writeFileSync(
      join(ctx.tmpDir, 'targets.json'),
      JSON.stringify({
        runId: ctx.runId,
        projectRoot: ctx.root,
        include: ctx.include.map(globToRegExpSource),
        exclude: ctx.exclude.map(globToRegExpSource),
      }),
    )
    writeFileSync(join(ctx.tmpDir, 'redact.json'), JSON.stringify(ctx.redact), { mode: 0o600 })
  }

  private env(ctx: PrepareContext, o: AdapterRunOptions | null): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' }
    for (const k of Object.keys(env)) if (k.startsWith('VARIA_')) Reflect.deleteProperty(env, k)
    Object.assign(env, ctx.env ?? {}, o?.env ?? {})
    const bootstrap = projectBootstrap(ctx.cwd ?? ctx.root)
    if (bootstrap !== null) env['VARIA_PHPUNIT_BOOTSTRAP'] = bootstrap
    return env
  }

  private args(cacheDir: string, extra: string[]): string[] {
    const ctx = this.ctx as PrepareContext
    return [
      join(ctx.root, 'vendor', 'phpunit', 'phpunit', 'phpunit'),
      '--bootstrap',
      BOOTSTRAP_PATH,
      '--extension',
      EXTENSION_CLASS,
      // Rien n'est écrit dans le projet : ni cache de résultats, ni couverture, ni journaux configurés.
      '--do-not-cache-result',
      '--cache-directory',
      cacheDir,
      '--no-coverage',
      '--no-logging',
      '--colors=never',
      ...extra,
    ]
  }

  /** Tests chargés par PHPUnit (extension en mode liste), une fois par préparation. */
  async listTests(timeoutMs: number): Promise<ListedTest[]> {
    const ctx = this.ctx as PrepareContext
    if (this.list !== null) return this.list
    const dir = join(ctx.tmpDir, 'phpunit-list')
    mkdirSync(dir, { recursive: true })
    const out = join(dir, 'tests.json')
    await runSupervised(this.php, this.args(join(dir, 'cache'), []), {
      cwd: ctx.cwd ?? ctx.root,
      env: { ...this.env(ctx, null), VARIA_PHPUNIT_LIST: out },
      timeoutMs,
      statusFile: statusFileIn(dir),
    })
    this.list = existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as ListedTest[]) : []
    return this.list
  }

  async run(o: AdapterRunOptions): Promise<AdapterRun> {
    const ctx = this.ctx
    if (ctx === null) throw new Error('PhpunitAdapter.prepare() doit être appelé avant run()')
    const resultsFile = join(o.runDir, 'phpunit-results.json')
    const select: string[] = []
    if (o.testName !== undefined && o.testFile !== undefined)
      select.push(
        '--filter',
        exactFilter(await this.listTests(o.timeoutMs), ctx.root, o.testFile, o.testName),
      )
    if (o.testFile !== undefined) select.push(join(ctx.root, o.testFile))
    const env = this.env(ctx, o)
    Object.assign(env, {
      VARIA_PHPUNIT_RESULTS: resultsFile,
      [PROBE_ENV.mode]: o.mode,
      [PROBE_ENV.runDir]: o.runDir,
      [PROBE_ENV.targets]: join(ctx.tmpDir, 'targets.json'),
      [PROBE_ENV.redact]: join(ctx.tmpDir, 'redact.json'),
      ...(o.planPath !== undefined ? { [PROBE_ENV.plan]: o.planPath } : {}),
      ...(o.mutationId !== undefined ? { [PROBE_ENV.mutationId]: o.mutationId } : {}),
    })
    const proc = await runSupervised(this.php, this.args(join(o.runDir, 'phpunit-cache'), select), {
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
    // Processus tué ou mort avant la fin (exit(), délai) : aucun résultat (écrit en fin d'exécution).
    const tests =
      proc.timedOut || !existsSync(resultsFile)
        ? null
        : parseResults(readFileSync(resultsFile, 'utf8'), ctx.root)
    return { process: proc, tests, events, truncatedLines, invalidLines }
  }
}
