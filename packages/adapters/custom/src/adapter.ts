// Adaptateur `custom` (J4 X-01, CDC §9.4) : branche un lanceur EXTERNE sans modifier Varia. Le lanceur
// est une commande (argv, sans shell) déclarée dans `varia.yml` ; il reçoit les variables du protocole
// de sonde (docs/probe-protocol.md) et celles du contrat custom (docs/writing-an-adapter.md), écrit
// les journaux JSONL de la sonde et un fichier de résultats. Ses capacités sont DÉCLARÉES dans
// `varia.yml` ; `varia doctor` les vérifie par ses tests de fumée (jamais crues sur parole).
import type {
  AdapterCapabilities,
  AdapterRun,
  AdapterRunOptions,
  CoverageRow,
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
} from '@varia/core'
import { loadConfig } from '@varia/config'
import { parseProbeLog, PROBE_ENV, type ProbeEvent } from '@varia/probe-protocol'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Variables du contrat custom, en plus de celles du protocole de sonde (`PROBE_ENV`). */
export const CUSTOM_ENV = {
  /** Fichier JSON `{ "tests": [{ file, name, status, durationMs }] }` à écrire en fin d'exécution. */
  results: 'VARIA_RESULTS',
  /** Sélection : fichier de test (relatif au projet, POSIX). */
  testFile: 'VARIA_TEST_FILE',
  /** Sélection : nom complet EXACT du test. */
  testName: 'VARIA_TEST_NAME',
  /** Modules ciblés : tableau JSON d'expressions régulières (chemin relatif POSIX). */
  include: 'VARIA_INCLUDE',
  /** Modules exclus : tableau JSON d'expressions régulières. */
  exclude: 'VARIA_EXCLUDE',
  /** Si présent : y écrire `coverage-summary.json` (format istanbul). */
  coverageDir: 'VARIA_COVERAGE_DIR',
  /** Commande de découverte : fichier JSON `{ "version"?, "tests": [{ file, name }] }` à écrire. */
  discover: 'VARIA_DISCOVER',
} as const

export interface CustomOptions {
  /** Commande de lancement (argv). `node` en tête : le Node qui exécute Varia. */
  command: string[]
  /** Commande de découverte optionnelle (argv) : liste les tests ; sert à `detect`. */
  discover?: string[]
  /** Capacités DÉCLARÉES (absentes ⇒ fausses). */
  capabilities?: Partial<AdapterCapabilities>
  /** Délai de la commande de découverte (ms). */
  discoverTimeoutMs?: number
  /** Environnement de recherche de la commande (`PATH`, `PATHEXT`) ; défaut : celui du processus. */
  env?: NodeJS.ProcessEnv
}

export interface DiscoveredTest {
  file: string
  name: string
}

const NO_CAPABILITY: AdapterCapabilities = {
  observation: false,
  argumentMutation: false,
  perTestSelection: false,
  asyncTargets: false,
  esm: false,
  cjs: false,
  mocks: false,
  testParameters: false,
  coverage: false,
  isolatedProcess: false,
  parallelSafe: false,
}

const STATUSES = new Set(['passed', 'failed', 'skipped', 'other'])

/** Identité de test du protocole (§8.1), recalculée côté Varia depuis le fichier de résultats. */
export function testIdOf(file: string, name: string, rank: number): string {
  const h = createHash('sha256').update([file, name, String(rank)].join('\u0000'), 'utf8')
  return 't_' + h.digest('hex').slice(0, 16)
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

/**
 * Lit le fichier de résultats du lanceur. `null` (aucun résultat exploitable) si absent, illisible ou
 * hors format : jamais de test deviné. Le rang des homonymes donne le `testId` du protocole.
 */
export function parseResults(file: string): TestResult[] | null {
  const doc = readJsonFile(file)
  if (!isRecord(doc) || !Array.isArray(doc['tests'])) return null
  const ranks = new Map<string, number>()
  const out: TestResult[] = []
  for (const t of doc['tests'] as unknown[]) {
    if (!isRecord(t)) return null
    const { file: f, name, status, durationMs } = t
    if (typeof f !== 'string' || typeof name !== 'string' || typeof status !== 'string') return null
    if (!STATUSES.has(status)) return null
    const key = `${f}\u0000${name}`
    const rank = ranks.get(key) ?? 0
    ranks.set(key, rank + 1)
    out.push({
      testId: testIdOf(f, name, rank),
      file: f,
      name,
      status: status as TestResult['status'],
      durationMs: typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs : null,
    })
  }
  return out
}

/** Lit la sortie de la commande de découverte ; `null` si hors format. */
export function parseDiscovery(
  file: string,
): { version: string | null; tests: DiscoveredTest[] } | null {
  const doc = readJsonFile(file)
  if (!isRecord(doc) || !Array.isArray(doc['tests'])) return null
  const tests: DiscoveredTest[] = []
  for (const t of doc['tests'] as unknown[]) {
    if (!isRecord(t) || typeof t['file'] !== 'string' || typeof t['name'] !== 'string') return null
    tests.push({ file: t['file'], name: t['name'] })
  }
  return { version: typeof doc['version'] === 'string' ? doc['version'] : null, tests }
}

const pathLike = (cmd: string) => cmd.startsWith('.') || cmd.includes('/') || cmd.includes('\\')

/** Exécutable de la commande : `node` ⇒ le Node de Varia ; chemin relatif ⇒ résolu dans `cwd`. */
export function resolveExecutable(cmd: string, cwd: string): string {
  if (cmd === 'node') return process.execPath
  return pathLike(cmd) && !isAbsolute(cmd) ? resolve(cwd, cmd) : cmd
}

/** La commande existe-t-elle ? Chemin : fichier présent ; nom nu : cherché dans `PATH` (+ `PATHEXT`). */
export function commandExists(cmd: string, cwd: string, env: NodeJS.ProcessEnv): boolean {
  if (cmd === 'node') return true
  if (pathLike(cmd) || isAbsolute(cmd)) return existsSync(resolveExecutable(cmd, cwd))
  const exts = ['', ...(env['PATHEXT'] ?? '').split(';').filter((e) => e !== '')]
  return (env['PATH'] ?? '')
    .split(delimiter)
    .filter((d) => d !== '')
    .some((d) => exts.some((e) => existsSync(join(d, cmd + e))))
}

export class CustomAdapter implements TestAdapter {
  readonly id = 'custom'
  private ctx: PrepareContext | null = null

  constructor(private readonly options: CustomOptions) {
    if (options.command.length === 0) throw new Error('CUSTOM_COMMAND_REQUIRED')
  }

  /** Adaptateur décrit par `test.custom` de `varia.yml` (erreur si la section est absente). */
  static fromConfig(root: string, configFile?: string): CustomAdapter {
    const custom = loadConfig(root, configFile !== undefined ? { file: configFile } : {}).parsed
      .test.custom
    if (custom === undefined) throw new Error('CUSTOM_COMMAND_REQUIRED')
    return new CustomAdapter({
      command: custom.command,
      ...(custom.discover !== undefined ? { discover: custom.discover } : {}),
      capabilities: custom.capabilities,
    })
  }

  /** Capacités DÉCLARÉES dans `varia.yml` ; `varia doctor` les vérifie. */
  capabilities(): AdapterCapabilities {
    return { ...NO_CAPABILITY, ...this.options.capabilities }
  }

  /** Tests listés par la commande de découverte ; `null` sans commande, en cas d'échec ou hors format. */
  async discover(
    root: string,
  ): Promise<{ version: string | null; tests: DiscoveredTest[] } | null> {
    const cmd = this.options.discover
    if (cmd === undefined) return null
    const dir = mkdtempSync(join(tmpdir(), 'varia-custom-discover-'))
    try {
      const out = join(dir, 'discover.json')
      const env: NodeJS.ProcessEnv = { ...process.env }
      for (const k of Object.keys(env)) if (k.startsWith('VARIA_')) Reflect.deleteProperty(env, k)
      env[CUSTOM_ENV.discover] = out
      const proc = await runSupervised(resolveExecutable(cmd[0] as string, root), cmd.slice(1), {
        cwd: root,
        env,
        timeoutMs: this.options.discoverTimeoutMs ?? 60_000,
        statusFile: statusFileIn(dir),
      })
      return proc.exitCode === 0 ? parseDiscovery(out) : null
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  async detect(root: string): Promise<DetectResult> {
    let detected: boolean
    let version: string | null = null
    if (this.options.discover !== undefined) {
      const d = await this.discover(root)
      detected = d !== null
      version = d?.version ?? null
    } else
      detected = commandExists(
        this.options.command[0] as string,
        root,
        this.options.env ?? process.env,
      )
    return {
      detected,
      framework: 'custom',
      version,
      // Le système de modules est l'affaire du lanceur : ses capacités esm/cjs le déclarent.
      nativeEsm: false,
      reasons: detected ? [] : ['RUNNER_NOT_FOUND'],
    }
  }

  async prepare(ctx: PrepareContext): Promise<void> {
    this.ctx = ctx
    writeFileSync(
      join(ctx.tmpDir, 'targets.json'),
      JSON.stringify({ runId: ctx.runId, projectRoot: ctx.root }),
    )
    writeFileSync(join(ctx.tmpDir, 'redact.json'), JSON.stringify(ctx.redact), { mode: 0o600 })
  }

  async run(o: AdapterRunOptions): Promise<AdapterRun> {
    const ctx = this.ctx
    if (ctx === null) throw new Error('CustomAdapter.prepare() doit être appelé avant run()')
    const cwd = ctx.cwd ?? ctx.root
    const results = join(o.runDir, 'results.json')
    const coverageDir = join(o.runDir, 'coverage')
    const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    for (const k of Object.keys(env)) if (k.startsWith('VARIA_')) Reflect.deleteProperty(env, k)
    // Environnement du projet (`test.env`), puis celui de l'exécution (reset), puis le contrat.
    Object.assign(env, ctx.env ?? {}, o.env ?? {})
    const nodeOptions = testNodeOptions(env['NODE_OPTIONS'], ctx)
    if (nodeOptions !== undefined) env['NODE_OPTIONS'] = nodeOptions
    Object.assign(env, {
      [PROBE_ENV.mode]: o.mode,
      [PROBE_ENV.runDir]: o.runDir,
      [PROBE_ENV.targets]: join(ctx.tmpDir, 'targets.json'),
      [PROBE_ENV.redact]: join(ctx.tmpDir, 'redact.json'),
      [CUSTOM_ENV.results]: results,
      [CUSTOM_ENV.include]: JSON.stringify(ctx.include.map(globToRegExpSource)),
      [CUSTOM_ENV.exclude]: JSON.stringify(ctx.exclude.map(globToRegExpSource)),
      ...(o.planPath !== undefined ? { [PROBE_ENV.plan]: o.planPath } : {}),
      ...(o.mutationId !== undefined ? { [PROBE_ENV.mutationId]: o.mutationId } : {}),
      ...(o.testFile !== undefined ? { [CUSTOM_ENV.testFile]: o.testFile } : {}),
      ...(o.testName !== undefined ? { [CUSTOM_ENV.testName]: o.testName } : {}),
      ...(o.coverage === true ? { [CUSTOM_ENV.coverageDir]: coverageDir } : {}),
    })
    const [cmd, ...args] = this.options.command as [string, ...string[]]
    const proc = await runSupervised(resolveExecutable(cmd, cwd), args, {
      cwd,
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
    const summary = join(coverageDir, 'coverage-summary.json')
    let coverage: CoverageRow[] | undefined
    if (o.coverage === true && existsSync(summary))
      try {
        coverage = parseCoverageSummary(readFileSync(summary, 'utf8'), ctx.root, (f) =>
          relative(ctx.root, resolve(ctx.root, f)).split(sep).join('/'),
        )
      } catch {
        // Résumé illisible : couverture inconnue (doctor ⇒ COVERAGE_NOT_PRODUCED), jamais inventée.
        coverage = undefined
      }
    return {
      process: proc,
      tests: proc.timedOut ? null : parseResults(results),
      events,
      truncatedLines,
      invalidLines,
      ...(coverage !== undefined ? { coverage } : {}),
    }
  }
}
