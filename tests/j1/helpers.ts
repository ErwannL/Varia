import { runCli, type Io } from '@varia/cli'
import { openReader, Reader } from '@varia/database'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const EXAMPLE = resolve('examples/jest-project')

export interface CliResult {
  code: number
  out: string
  err: string
}

/** Lance le VRAI CLI (même code que `bin/varia`) en mémoire. */
export async function varia(args: string[], cwd = EXAMPLE): Promise<CliResult> {
  const out: string[] = []
  const err: string[] = []
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l) }
  const code = await runCli(args, io, { env: { ...process.env, LANG: 'fr_FR.UTF-8' }, cwd })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

export const json = <T>(r: CliResult): T => JSON.parse(r.out) as T

export function newDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'varia-j1-'))
}

/** Dossier de données du projet sous `--data-dir`. */
export function projectDir(dataDir: string): string {
  const [name] = readdirSync(join(dataDir, 'projects'))
  return join(dataDir, 'projects', name ?? '')
}

export function withReader<T>(dataDir: string, fn: (r: Reader) => T): T {
  const o = openReader(join(projectDir(dataDir), 'varia.db'))
  try {
    return fn(new Reader(o.db))
  } finally {
    o.close()
  }
}

/**
 * Configuration DÉTERMINISTE de l'exemple (F-02), hors du projet : sans les cibles qui bouclent
 * (`repeat`), quittent le processus (`exitOn`), dépendent de l'horloge (`stamp`) ou de l'ordonnanceur
 * (`outer`, `scheduleWelcome`) ; délai large et explicite (aucune cible ne boucle) : le résultat ne
 * dépend pas de la vitesse de la machine.
 */
export function deterministicConfig(extra: string[] = []): string {
  const file = join(mkdtempSync(join(tmpdir(), 'varia-cfg-')), 'varia.yml')
  writeFileSync(
    file,
    [
      'version: 1',
      'project: { name: jest-project }',
      "targets: { mode: auto, include: ['src/**'], exclude: ['src/values.js', 'src/notify.js', 'src/chain.js'] }",
      'mutations: { mode: normal, seed: 42 }',
      'execution: { timeout_ms: 30000 }',
      // Drapeau SLOW (fonction de la durée mesurée) neutralisé : une machine chargée en produirait
      // des issues variables d'un run à l'autre. SLOW est testé à part (packages/core, tests/j3).
      'oracle: { handled_errors: [{ name: ValidationError }], slow_floor_ms: 3600000 }',
      ...extra,
    ].join('\n'),
  )
  return file
}
