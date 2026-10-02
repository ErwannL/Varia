// Point d'entrée : stockage par défaut et erreur interne inattendue (jamais silencieuse, exit INFRA).
import type { TestAdapter } from '@varia/core'
import { projectDataDir } from '@varia/core'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { scripted } from '../../engine/test/fake.js'
import { runCli, type Io } from '../src/index.js'

function project(): string {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'varia-prog-')))
  writeFileSync(join(d, 'varia.yml'), 'version: 1\n')
  return d
}

async function run(argv: string[], cwd: string, adapter: () => TestAdapter) {
  const out: string[] = []
  const err: string[] = []
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l) }
  const code = await runCli(argv, io, { env: { LANG: 'fr_FR.UTF-8' }, cwd, adapter })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('runCli', () => {
  it('sans --data-dir : base dans le répertoire de données utilisateur, rien dans le projet', async () => {
    const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'varia-home-')))
    vi.stubEnv('XDG_DATA_HOME', home)
    vi.stubEnv('LOCALAPPDATA', home)
    try {
      const d = project()
      const r = await run(['-q', 'baseline'], d, () => scripted([{ name: 'a', calls: [] }]))
      expect(r.code).toBe(0)
      expect(existsSync(join(projectDataDir(d), 'varia.db'))).toBe(true)
      expect(existsSync(join(d, '.varia'))).toBe(false)
      rmSync(projectDataDir(d), { recursive: true, force: true })
    } finally {
      vi.unstubAllEnvs()
    }
  })
  it('erreur interne : signalée avec sa pile, code INFRA (4)', async () => {
    const d = project()
    const r = await run(['--data-dir', join(d, '.data'), 'baseline'], d, () => {
      throw new Error('panne imprévue')
    })
    expect(r.code).toBe(4)
    expect(r.err).toContain('VARIA_INTERNAL_FAILURE')
    expect(r.err).toMatch(/Error: panne imprévue\n\s+at /)
  })
  it('valeur non-Error levée : rendue telle quelle, code INFRA (4)', async () => {
    const d = project()
    const r = await run(['--data-dir', join(d, '.data'), 'baseline'], d, () => {
      throw 'chaîne levée'
    })
    expect(r.code).toBe(4)
    expect(r.err).toContain('chaîne levée')
  })
})
