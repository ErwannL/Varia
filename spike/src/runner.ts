import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEventLog, type EventLog } from './events.js'
import { globToRegExpSource } from './glob.js'
import { generateJestConfig, loadProjectJestConfig, resolveJestBin } from './jest-config.js'
import { projectDataDir } from './paths.js'
import { runProcess, type ProcessResult } from './proc.js'

const RUNTIME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'runtime')

export const DEFAULT_REDACT_FIELDS = [
  'password',
  'token',
  'apiKey',
  'authorization',
  'cookie',
  'secret',
  'privateKey',
]

export interface SessionOptions {
  root: string
  dataDir?: string
  include?: string[]
  exclude?: string[]
  redactFields?: string[]
  skipPaths?: string[]
  timeoutMs?: number
  /** Sans sonde : mesure du coût de référence (`probe_overhead_pct`). */
  probe?: boolean
  /** Options Node ajoutées au processus Jest (ex. `--experimental-vm-modules` pour l'ESM natif). */
  nodeOptions?: string
}

export interface JestAssertion {
  fullName: string
  status: string
  title: string
  ancestorTitles: string[]
}

export interface JestReport {
  success: boolean
  numTotalTests: number
  numPassedTests: number
  testResults: { name: string; status: string; assertionResults: JestAssertion[] }[]
}

export interface JestRun {
  process: ProcessResult
  report: JestReport | null
  log: EventLog
  runDir: string
}

export interface RunJestOptions {
  mode: 'observe' | 'fuzz'
  testFile?: string
  testName?: string
  planPath?: string
  mutationId?: string
  keepTmp?: boolean
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Une session = un run Varia sur un projet : dossier `tmp/` hors du projet, config Jest générée. */
export class Session {
  readonly root: string
  readonly dataDir: string
  readonly tmpDir: string
  readonly runId: string
  readonly hmacKey: string
  private readonly opts: SessionOptions
  private configPath = ''
  private counter = 0

  constructor(opts: SessionOptions) {
    this.opts = opts
    this.root = resolve(opts.root)
    this.dataDir = projectDataDir(this.root, opts.dataDir)
    this.runId = 'r_' + randomBytes(6).toString('hex')
    this.tmpDir = join(this.dataDir, 'tmp', this.runId)
    this.hmacKey = this.projectKey()
  }

  /** Clé HMAC par projet, persistée dans le stockage Varia (stable entre runs, jamais dans le projet). */
  private projectKey(): string {
    const p = join(this.dataDir, 'fingerprint.key')
    if (!existsSync(p)) {
      mkdirSync(this.dataDir, { recursive: true })
      writeFileSync(p, randomBytes(32).toString('hex'), { mode: 0o600 })
    }
    return readFileSync(p, 'utf8').trim()
  }

  async prepare(): Promise<void> {
    mkdirSync(this.tmpDir, { recursive: true })
    const project = await loadProjectJestConfig(this.root)
    const include = (this.opts.include ?? ['src/**']).map(globToRegExpSource)
    const exclude = (this.opts.exclude ?? []).map(globToRegExpSource)
    const config =
      this.opts.probe === false
        ? {
            ...project,
            rootDir: this.root,
            cacheDirectory: join(this.tmpDir, 'jest-cache'),
            watchman: false,
          }
        : generateJestConfig({
            root: this.root,
            project,
            transformPath: join(RUNTIME_DIR, 'transform.cjs'),
            probePath: join(RUNTIME_DIR, 'probe.cjs'),
            include,
            exclude,
            cacheDirectory: join(this.tmpDir, 'jest-cache'),
            salt: this.runId,
          })
    this.configPath = join(this.tmpDir, 'jest.config.json')
    writeFileSync(this.configPath, JSON.stringify(config, null, 2))
    writeFileSync(
      join(this.tmpDir, 'targets.json'),
      JSON.stringify({ runId: this.runId, projectRoot: this.root }),
    )
    writeFileSync(
      join(this.tmpDir, 'redact.json'),
      JSON.stringify({
        fields: this.opts.redactFields ?? DEFAULT_REDACT_FIELDS,
        skipPaths: this.opts.skipPaths ?? [],
        hmacKey: this.hmacKey,
      }),
      { mode: 0o600 },
    )
  }

  async runJest(o: RunJestOptions): Promise<JestRun> {
    if (this.configPath === '') await this.prepare()
    const runDir = join(this.tmpDir, `exec-${String(++this.counter).padStart(5, '0')}`)
    mkdirSync(runDir, { recursive: true })
    const args = [
      resolveJestBin(this.root),
      '--config',
      this.configPath,
      '--runInBand',
      '--ci',
      '--json',
      '--colors=false',
      '--watchman=false',
    ]
    if (o.testFile !== undefined) {
      args.push('--runTestsByPath', join(this.root, o.testFile))
    }
    if (o.testName !== undefined) args.push('--testNamePattern', `^${escapeRegExp(o.testName)}$`)
    const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0' }
    for (const k of Object.keys(env)) if (k.startsWith('VARIA_')) Reflect.deleteProperty(env, k)
    if (this.opts.nodeOptions !== undefined) {
      env['NODE_OPTIONS'] = `${env['NODE_OPTIONS'] ?? ''} ${this.opts.nodeOptions}`.trim()
    }
    if (this.opts.probe !== false) {
      Object.assign(env, {
        VARIA_MODE: o.mode,
        VARIA_RUN_DIR: runDir,
        VARIA_TARGETS: join(this.tmpDir, 'targets.json'),
        VARIA_REDACT: join(this.tmpDir, 'redact.json'),
        ...(o.planPath !== undefined ? { VARIA_PLAN: o.planPath } : {}),
        ...(o.mutationId !== undefined ? { VARIA_MUTATION_ID: o.mutationId } : {}),
      })
    }
    const proc = await runProcess(process.execPath, args, {
      cwd: this.root,
      env,
      timeoutMs: this.opts.timeoutMs ?? 30_000,
    })
    let report: JestReport | null = null
    const start = proc.stdout.indexOf('{')
    if (start >= 0) {
      try {
        report = JSON.parse(proc.stdout.slice(start)) as JestReport
      } catch {
        report = null
      }
    }
    const log = readEventLog(runDir)
    if (o.keepTmp !== true) rmSync(runDir, { recursive: true, force: true })
    return { process: proc, report, log, runDir }
  }

  /** Chemin d'un fichier de test relatif au projet, séparateurs `/`. */
  rel(file: string): string {
    return relative(this.root, file).split(sep).join('/')
  }

  /** Supprime le dossier temporaire du run (CDC §10.6 : purge après ingestion). */
  dispose(): void {
    rmSync(this.tmpDir, { recursive: true, force: true })
  }
}
