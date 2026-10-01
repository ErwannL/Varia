import { loadConfig, ConfigError, type ResolvedConfig } from '@varia/config'
import { projectDataDir, type TestAdapter } from '@varia/core'
import { openWriter, Reader, Writer, type Opened } from '@varia/database'
import { sha256 } from '@varia/probe-runtime'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import pino, { type Logger } from 'pino'
import { VariaError } from './errors.js'
import { VARIA_VERSION } from './version.js'

export type ProgressEvent =
  | { type: 'phase'; phase: string; detail?: string }
  | { type: 'baseline'; run: number; of: number; passed: number; total: number; durationMs: number }
  | { type: 'plan'; mutations: number; possible: number; estimateMs: number; warn: boolean }
  | { type: 'mutation'; index: number; of: number; id: string; status: string; subtype?: string }
  | { type: 'warning'; message: string }

export interface EngineOptions {
  root: string
  adapter: TestAdapter
  dataDir?: string
  mode?: 'quick' | 'normal' | 'full'
  onProgress?: (e: ProgressEvent) => void
}

/** Contexte d'une commande : configuration, stockage, base (écrivaine unique), journal. */
export class EngineContext {
  readonly root: string
  readonly config: ResolvedConfig
  readonly adapter: TestAdapter
  readonly dataDir: string
  readonly projectId: string
  readonly db: Opened
  readonly writer: Writer
  readonly reader: Reader
  readonly log: Logger
  readonly emit: (e: ProgressEvent) => void

  constructor(o: EngineOptions) {
    try {
      this.config = loadConfig(resolve(o.root), o.mode !== undefined ? { mode: o.mode } : {})
    } catch (e) {
      if (e instanceof ConfigError) throw new VariaError('CONFIG_FAILURE', e.message, e.issues)
      throw e
    }
    this.root = this.config.root
    this.adapter = o.adapter
    const storage = this.config.parsed.storage
    this.dataDir =
      o.dataDir !== undefined
        ? projectDataDir(this.root, resolve(o.dataDir))
        : storage.path !== undefined
          ? projectDataDir(this.root, resolve(this.root, storage.path))
          : storage.location === 'project'
            ? join(this.root, '.varia')
            : projectDataDir(this.root)
    mkdirSync(this.dataDir, { recursive: true })
    if (storage.location === 'project' && o.dataDir === undefined && storage.path === undefined)
      excludeFromGit(this.root)
    this.projectId = 'p_' + sha256(this.root).slice(0, 12)
    this.db = openWriter(join(this.dataDir, 'varia.db'))
    this.writer = new Writer(this.db.db)
    this.reader = new Reader(this.db.db)
    mkdirSync(join(this.dataDir, 'logs'), { recursive: true })
    this.log = pino(
      { base: { projectId: this.projectId } },
      pino.destination({ dest: join(this.dataDir, 'logs', 'varia.log'), sync: true, append: true }),
    )
    this.emit = o.onProgress ?? (() => undefined)
  }

  /** Clé HMAC par projet, stockée hors du projet, stable entre runs (empreintes comparables). */
  hmacKey(): string {
    const p = join(this.dataDir, 'fingerprint.key')
    if (!existsSync(p)) writeFileSync(p, randomBytes(32).toString('hex'), { mode: 0o600 })
    return readFileSync(p, 'utf8').trim()
  }

  git(): { commit: string | null; branch: string | null } {
    const run = (args: string[]) => {
      try {
        return execFileSync('git', args, {
          cwd: this.root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
      } catch {
        return null
      }
    }
    return {
      commit: run(['rev-parse', 'HEAD']),
      branch: run(['rev-parse', '--abbrev-ref', 'HEAD']),
    }
  }

  envHash(adapterVersion: string | null): string {
    return sha256(
      [
        process.version,
        process.platform,
        process.arch,
        VARIA_VERSION,
        this.adapter.id,
        adapterVersion ?? '',
      ].join('|'),
    )
  }

  close(): void {
    this.log.flush()
    this.db.close()
  }
}

/** `storage.location: project` : `.varia/` exclu via `.git/info/exclude`, jamais `.gitignore` (§4.3). */
function excludeFromGit(root: string): void {
  const exclude = join(root, '.git', 'info', 'exclude')
  if (!existsSync(join(root, '.git'))) return
  const content = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
  if (!content.split('\n').includes('.varia/')) {
    mkdirSync(join(root, '.git', 'info'), { recursive: true })
    appendFileSync(exclude, `${content.endsWith('\n') || content === '' ? '' : '\n'}.varia/\n`)
  }
}
