import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SUPERVISOR_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'runtime',
  'supervisor.cjs',
)

export interface ProcessResult {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  durationMs: number
  stdout: string
  stderr: string
  outputTruncated: boolean
  pid: number | undefined
}

export interface RunProcessOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  /** Fichier d'état écrit par le superviseur (timeout, code de sortie réel de la commande). */
  statusFile: string
  maxOutputBytes?: number
}

/** Tue un arbre de processus : groupe en POSIX, `taskkill /T /F` sous Windows. */
export function killTree(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  run = spawnSync,
): void {
  if (platform === 'win32') {
    run('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // groupe déjà terminé
  }
}

/** Vrai si le groupe de processus (POSIX) a encore un membre vivant. */
export function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

/** Attend (au plus `ms`) que le groupe de processus ait disparu ; les zombies sont récoltés de façon asynchrone. */
export async function waitGroupGone(pid: number, ms = 2000): Promise<boolean> {
  const deadline = performance.now() + ms
  while (groupAlive(pid)) {
    if (performance.now() > deadline) return false
    await new Promise((r) => setTimeout(r, 20))
  }
  return true
}

interface SupervisorStatus {
  timedOut: boolean
  exitCode: number | null
  signal: string | null
}

/**
 * Lance `command` sous le superviseur (chef de groupe détaché) : le timeout est appliqué même si
 * l'orchestrateur meurt. Une marge de sécurité côté orchestrateur tue l'arbre si le superviseur échoue.
 */
export function runSupervised(
  command: string,
  args: string[],
  opts: RunProcessOptions,
): Promise<ProcessResult> {
  const max = opts.maxOutputBytes ?? 8 * 1024 * 1024
  const started = performance.now()
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [SUPERVISOR_PATH, String(opts.timeoutMs), opts.statusFile, '--', command, ...args],
      {
        cwd: opts.cwd,
        env: opts.env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    let truncated = false
    const collect = (sink: Buffer[]) => (chunk: Buffer) => {
      if (size + chunk.length > max) {
        truncated = true
        return
      }
      size += chunk.length
      sink.push(chunk)
    }
    child.stdout.on('data', collect(out))
    child.stderr.on('data', collect(err))
    let backstop = false
    const timer = setTimeout(() => {
      backstop = true
      if (child.pid !== undefined) killTree(child.pid)
    }, opts.timeoutMs + 5000)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (child.pid !== undefined && process.platform !== 'win32') killTree(child.pid)
      let status: SupervisorStatus = { timedOut: backstop, exitCode: code, signal }
      if (existsSync(opts.statusFile)) {
        status = JSON.parse(readFileSync(opts.statusFile, 'utf8')) as SupervisorStatus
        status.timedOut ||= backstop
      }
      resolvePromise({
        exitCode: status.exitCode,
        signal: status.signal,
        timedOut: status.timedOut,
        durationMs: performance.now() - started,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        outputTruncated: truncated,
        pid: child.pid,
      })
    })
  })
}

export const statusFileIn = (dir: string) => join(dir, 'supervisor.json')
