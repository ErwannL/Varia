import { killTree } from '@varia/core'
import { spawn as nodeSpawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, closeSync, openSync, readSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Lancement de Varia DEPUIS le tableau de bord (`varia dashboard --allow-run`).
 *
 * 🔴 Fermé par construction : trois types de travaux seulement (baseline, test rapide, test complet), des
 * entiers bornés pour tout paramètre, jamais une chaîne de l'appelant dans la ligne de commande. Un seul
 * travail à la fois. Le travail est Varia LUI-MÊME (`varia baseline` / `varia test`) relancé dans le projet
 * du tableau de bord avec les mêmes options globales : aucun autre programme, aucun autre dossier.
 */
export const JOB_KINDS = ['baseline', 'quick', 'complete'] as const
export type JobKind = (typeof JOB_KINDS)[number]

/** `DONE` : le travail est allé au bout (code 0, ou 1 = des problèmes de résilience ont été TROUVÉS). */
export type JobState = 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELED'

export const JOB_LIMITS = {
  maxMutations: 100_000,
  minSeconds: 10,
  maxSeconds: 86_400,
  /** Taille de la fin du journal rendue par l'API. */
  logTailBytes: 32_768,
  /** Travaux conservés en mémoire (les plus récents). */
  keep: 10,
} as const

export interface JobRequest {
  kind: JobKind
  /** Nombre maximal de mutations (`varia test --max-mutations`) ; refusé pour la baseline. */
  maxMutations?: number
  /** Durée maximale en secondes (`varia test --max-time`) ; refusée pour la baseline. */
  maxTimeSeconds?: number
}

export interface JobView {
  id: string
  kind: JobKind
  state: JobState
  exitCode: number | null
  startedAt: string
  finishedAt: string | null
  /** Commande équivalente, pour l'affichage (`varia test --quick --max-mutations 50`). */
  command: string
  /** Fin du journal (sortie standard et d'erreur de Varia). */
  log: string
  logTruncated: boolean
}

export interface JobRunnerInfo {
  name: string
  root: string
  config: string | null
}

export interface JobRunnerOptions {
  /** Commande qui lance Varia lui-même : `[node, script]`. */
  command: string[]
  /** Options globales répétées à chaque travail : `-C`, `-c`, `--data-dir`, `--lang`. */
  globalArgs: string[]
  /** Dossier du projet (répertoire de travail). */
  cwd: string
  env: NodeJS.ProcessEnv
  /** Dossier des journaux (supprimé à la fermeture). */
  logDir: string
  info: JobRunnerInfo
  /** Injectables en test. */
  spawn?: typeof nodeSpawn | undefined
  kill?: ((pid: number) => void) | undefined
  platform?: NodeJS.Platform | undefined
  now?: (() => Date) | undefined
}

/** Paramètre refusé : le code est stable (l'API le rend tel quel en 400). */
export class InvalidJob extends Error {
  constructor(
    readonly code:
      | 'INVALID_KIND'
      | 'INVALID_MAX_MUTATIONS'
      | 'INVALID_MAX_TIME'
      | 'PARAMETERS_NOT_FOR_BASELINE',
  ) {
    super(code)
  }
}

/** `undefined` : absent ; `null` : présent mais invalide. */
function intIn(value: unknown, min: number, max: number): number | null | undefined {
  if (value === undefined) return undefined
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null
}

/** Arguments de Varia pour un travail (validés) : la SEULE façon de construire la ligne de commande. */
export function jobArgs(req: JobRequest): string[] {
  if (!JOB_KINDS.includes(req.kind)) throw new InvalidJob('INVALID_KIND')
  const mutations = intIn(req.maxMutations, 1, JOB_LIMITS.maxMutations)
  const seconds = intIn(req.maxTimeSeconds, JOB_LIMITS.minSeconds, JOB_LIMITS.maxSeconds)
  if (mutations === null) throw new InvalidJob('INVALID_MAX_MUTATIONS')
  if (seconds === null) throw new InvalidJob('INVALID_MAX_TIME')
  if (req.kind === 'baseline') {
    if (mutations !== undefined || seconds !== undefined)
      throw new InvalidJob('PARAMETERS_NOT_FOR_BASELINE')
    return ['baseline']
  }
  return [
    'test',
    ...(req.kind === 'quick' ? ['--quick'] : []),
    ...(mutations === undefined ? [] : ['--max-mutations', String(mutations)]),
    ...(seconds === undefined ? [] : ['--max-time', String(seconds)]),
  ]
}

interface Job {
  id: string
  kind: JobKind
  args: string[]
  logFile: string
  startedAt: Date
  finishedAt: Date | null
  exitCode: number | null
  state: JobState
  /** Identifiant du processus lancé ; `undefined` tant qu'il n'existe pas (échec du lancement). */
  pid: number | undefined
  cancelRequested: boolean
}

/** Fin d'un fichier (au plus `bytes` octets) ; `truncated` si le début a été coupé. */
function tailOf(file: string, bytes: number): { text: string; truncated: boolean } {
  const size = statSync(file).size
  const start = Math.max(0, size - bytes)
  const buffer = Buffer.alloc(size - start)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buffer, 0, buffer.length, start)
  } finally {
    closeSync(fd)
  }
  return { text: buffer.toString('utf8'), truncated: start > 0 }
}

export class JobRunner {
  private readonly jobs: Job[] = []
  private readonly spawn: typeof nodeSpawn
  private readonly kill: (pid: number) => void
  private readonly platform: NodeJS.Platform
  private readonly now: () => Date

  constructor(private readonly o: JobRunnerOptions) {
    this.spawn = o.spawn ?? nodeSpawn
    this.platform = o.platform ?? process.platform
    this.kill = o.kill ?? ((pid) => killTree(pid, this.platform))
    this.now = o.now ?? (() => new Date())
  }

  info(): JobRunnerInfo {
    return this.o.info
  }

  /** Lance un travail ; `'BUSY'` si un autre tourne encore. Paramètre invalide ⇒ `InvalidJob`. */
  start(req: JobRequest): JobView | 'BUSY' {
    const args = jobArgs(req)
    if (this.jobs.some((j) => j.state === 'RUNNING')) return 'BUSY'
    const id = `j_${randomBytes(6).toString('hex')}`
    const logFile = join(this.o.logDir, `${id}.log`)
    const fd = openSync(logFile, 'a')
    const job: Job = {
      id,
      kind: req.kind,
      args,
      logFile,
      startedAt: this.now(),
      finishedAt: null,
      exitCode: null,
      state: 'RUNNING',
      pid: undefined,
      cancelRequested: false,
    }
    this.jobs.unshift(job)
    for (const old of this.jobs.splice(JOB_LIMITS.keep)) rmSync(old.logFile, { force: true })
    try {
      const [bin = '', ...head] = this.o.command
      const child = this.spawn(bin, [...head, ...this.o.globalArgs, ...args], {
        cwd: this.o.cwd,
        env: { ...this.o.env, NO_COLOR: '1', FORCE_COLOR: '0' },
        stdio: ['ignore', fd, fd],
        // Groupe de processus propre (POSIX) pour pouvoir tuer tout l'arbre ; Windows : `taskkill /T`.
        detached: this.platform !== 'win32',
        windowsHide: true,
      })
      job.pid = child.pid
      child.once('error', (error) => {
        appendFileSync(job.logFile, `${error.message}\n`)
        this.finish(job, null)
      })
      child.once('exit', (code) => this.finish(job, code))
    } catch (error) {
      // Lancement impossible (arguments refusés par le système) : le travail échoue, il ne reste pas « en cours ».
      appendFileSync(job.logFile, `${(error as Error).message}\n`)
      this.finish(job, null)
    } finally {
      closeSync(fd)
    }
    return this.view(job)
  }

  private finish(job: Job, code: number | null): void {
    if (job.state !== 'RUNNING') return
    job.exitCode = code
    job.finishedAt = this.now()
    if (job.cancelRequested) job.state = 'CANCELED'
    else job.state = code === 0 || code === 1 ? 'DONE' : 'FAILED'
  }

  list(): JobView[] {
    return this.jobs.map((j) => this.view(j))
  }

  get(id: string): JobView | null {
    const job = this.jobs.find((j) => j.id === id)
    return job === undefined ? null : this.view(job)
  }

  /** Arrête un travail en cours (tout son arbre de processus) ; inconnu ⇒ `null`. */
  cancel(id: string): JobView | null {
    const job = this.jobs.find((j) => j.id === id)
    if (job === undefined) return null
    if (job.state === 'RUNNING') {
      job.cancelRequested = true
      if (job.pid !== undefined) this.kill(job.pid)
    }
    return this.view(job)
  }

  /** Arrête le travail en cours et supprime les journaux (fermeture du serveur). */
  close(): void {
    for (const job of this.jobs) {
      if (job.state === 'RUNNING' && job.pid !== undefined) this.kill(job.pid)
    }
    rmSync(this.o.logDir, { recursive: true, force: true })
  }

  private view(job: Job): JobView {
    const tail = tailOf(job.logFile, JOB_LIMITS.logTailBytes)
    return {
      id: job.id,
      kind: job.kind,
      state: job.state,
      exitCode: job.exitCode,
      startedAt: job.startedAt.toISOString(),
      finishedAt: job.finishedAt === null ? null : job.finishedAt.toISOString(),
      command: `varia ${job.args.join(' ')}`,
      log: tail.text,
      logTruncated: tail.truncated,
    }
  }
}
