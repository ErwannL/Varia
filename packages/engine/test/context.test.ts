import type { TestAdapter } from '@varia/core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EngineContext, VariaError, EXIT, replayMutation } from '../src/index.js'

const fakeAdapter: TestAdapter = {
  id: 'fake',
  detect: async () => ({
    detected: true,
    framework: 'fake',
    version: '1',
    nativeEsm: false,
    reasons: [],
  }),
  capabilities: () => ({
    observation: true,
    argumentMutation: true,
    perTestSelection: true,
    asyncTargets: true,
    esm: false,
    cjs: true,
    mocks: false,
    testParameters: true,
    coverage: false,
    isolatedProcess: true,
    parallelSafe: false,
  }),
  prepare: async () => undefined,
  run: async () => {
    throw new Error('non utilisé')
  },
}

const project = (yml: string, git = false) => {
  // Racine canonique (D-022) : `tmpdir()` est un lien sous macOS (`/var` → `/private/var`).
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'varia-ctx-')))
  writeFileSync(join(d, 'varia.yml'), yml)
  if (git) execFileSync('git', ['init', '-q'], { cwd: d })
  return d
}

describe('contexte du moteur', () => {
  it('storage.location: project ⇒ .varia/ exclu par .git/info/exclude, jamais .gitignore', () => {
    const d = project('version: 1\nstorage: { location: project }\n', true)
    const ctx = new EngineContext({ root: d, adapter: fakeAdapter })
    ctx.close()
    expect(ctx.dataDir).toBe(join(d, '.varia'))
    expect(readFileSync(join(d, '.git', 'info', 'exclude'), 'utf8').split('\n')).toContain(
      '.varia/',
    )
    expect(existsSync(join(d, '.gitignore'))).toBe(false)
    new EngineContext({ root: d, adapter: fakeAdapter }).close()
    expect(
      readFileSync(join(d, '.git', 'info', 'exclude'), 'utf8').match(/\.varia\//g),
    ).toHaveLength(1)
  })
  it('storage.path et --data-dir', () => {
    const d = project('version: 1\nstorage: { path: ../store }\n')
    const a = new EngineContext({ root: d, adapter: fakeAdapter })
    a.close()
    expect(a.dataDir).toContain(join(d, '..', 'store'))
    const b = new EngineContext({ root: d, adapter: fakeAdapter, dataDir: join(d, 'x') })
    b.close()
    expect(b.dataDir.startsWith(join(d, 'x'))).toBe(true)
  })
  it('clé d’empreinte stable, git absent, empreinte d’environnement', () => {
    const d = project('version: 1\n')
    const ctx = new EngineContext({ root: d, adapter: fakeAdapter, dataDir: join(d, 'data') })
    expect(ctx.hmacKey()).toBe(ctx.hmacKey())
    expect(ctx.git()).toEqual({ commit: null, branch: null })
    expect(ctx.envHash('1')).not.toBe(ctx.envHash('2'))
    ctx.close()
  })
  it('configuration invalide ⇒ VariaError CONFIG_FAILURE (code 3)', () => {
    const d = project('version: 9\n')
    try {
      new EngineContext({ root: d, adapter: fakeAdapter })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(VariaError)
      expect([(e as VariaError).kind, (e as VariaError).exitCode]).toEqual([
        'CONFIG_FAILURE',
        EXIT.CONFIG,
      ])
    }
  })
  it('rejeu d’une mutation inconnue ⇒ PROJECT_FAILURE', async () => {
    const d = project('version: 1\n')
    const ctx = new EngineContext({ root: d, adapter: fakeAdapter, dataDir: join(d, 'data') })
    await expect(replayMutation(ctx, 'm_inconnue')).rejects.toMatchObject({
      kind: 'PROJECT_FAILURE',
    })
    ctx.close()
  })
})
