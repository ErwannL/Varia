import { runSupervised, statusFileIn, type ProcessResult } from '@varia/core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineContext } from './context.js'

/** Shell de la plateforme pour une commande de l'utilisateur (`database_command`). */
export function shellFor(
  command: string,
  platform: NodeJS.Platform = process.platform,
): [string, string[]] {
  return platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', command]]
    : ['/bin/sh', ['-c', command]]
}

/**
 * Reset de base avant une mutation (`execution.reset.database: command`, CDC §16.4) : la commande
 * s'exécute dans le projet, avec l'environnement de test, sous le même timeout qu'une mutation.
 * Rend `null` si aucun reset n'est configuré, sinon le résultat du processus.
 */
export async function resetDatabase(
  ctx: EngineContext,
  dir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<ProcessResult | null> {
  const reset = ctx.config.parsed.execution.reset
  if (reset.database !== 'command') return null
  const [bin, args] = shellFor(reset.database_command, platform)
  mkdirSync(dir, { recursive: true })
  return runSupervised(bin, args, {
    cwd: ctx.testCwd,
    env: { ...process.env, ...ctx.config.parsed.test.env },
    timeoutMs: ctx.config.parsed.execution.timeout_ms,
    statusFile: statusFileIn(dir),
    platform,
  })
}

/** Le reset a-t-il réussi ? (code 0, ni timeout ni signal) */
export const resetSucceeded = (p: ProcessResult) =>
  !p.timedOut && p.signal === null && p.exitCode === 0

/**
 * Isolation du système de fichiers (`execution.reset.filesystem: tmpdir`, CDC §16.4-16.5) : répertoire
 * jetable propre à la mutation, exposé par `VARIA_TMPDIR`, `TMPDIR`, `TMP` et `TEMP` ; il vit dans le
 * dossier de la mutation, supprimé après elle.
 */
export function filesystemEnv(ctx: EngineContext, runDir: string): Record<string, string> {
  if (ctx.config.parsed.execution.reset.filesystem !== 'tmpdir') return {}
  const dir = join(runDir, 'fs-tmp')
  mkdirSync(dir, { recursive: true })
  return { VARIA_TMPDIR: dir, TMPDIR: dir, TMP: dir, TEMP: dir }
}
