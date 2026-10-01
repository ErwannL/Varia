import { spawn, spawnSync } from 'node:child_process'

export interface ProcessResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
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
  maxOutputBytes?: number
}

/** Tue l'arbre de processus (CDC §16.2) : groupe de processus en POSIX, `taskkill /T /F` sous Windows. */
export function killTree(pid: number, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
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

export function runProcess(
  command: string,
  args: string[],
  opts: RunProcessOptions,
): Promise<ProcessResult> {
  const max = opts.maxOutputBytes ?? 8 * 1024 * 1024
  const started = performance.now()
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
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
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid !== undefined) killTree(child.pid)
    }, opts.timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer)
      if (child.pid !== undefined && process.platform !== 'win32') killTree(child.pid)
      resolvePromise({
        exitCode,
        signal,
        timedOut,
        durationMs: performance.now() - started,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        outputTruncated: truncated,
        pid: child.pid,
      })
    })
  })
}
