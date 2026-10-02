// Tests unitaires de l'adapter Vitest : exports, rapport, détection et lancement (runner simulé).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: string[]; opts: Record<string, unknown> }[],
  result: { stdout: '', timedOut: false } as Record<string, unknown>,
  hideRuntime: false,
}))

vi.mock('@varia/core', async (orig) => ({
  ...(await orig<typeof import('@varia/core')>()),
  runSupervised: (cmd: string, args: string[], opts: Record<string, unknown>) => {
    h.calls.push({ cmd, args, opts })
    return Promise.resolve(h.result)
  },
}))
vi.mock('node:fs', async (orig) => {
  const fs = await orig<typeof import('node:fs')>()
  const existsSync = (p: string) =>
    h.hideRuntime && p.endsWith('run-vitest.mjs') ? false : fs.existsSync(p)
  return { ...fs, existsSync, default: { ...fs, existsSync } }
})

const { VitestAdapter, exportEntry, parseVitestReport } = await import('../src/adapter.js')

function dir(files: Record<string, string> = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'varia-vitest-'))
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(d, f, '..'), { recursive: true })
    writeFileSync(join(d, f), c)
  }
  return d
}
const FAKE_VITEST = {
  'package.json': '{}',
  'node_modules/vitest/package.json': JSON.stringify({
    name: 'vitest',
    version: '3.0.1',
    exports: {
      '.': { import: { default: './dist/index.js' } },
      './package.json': './package.json',
    },
  }),
}
const redact = { fields: [], patterns: [], skipPaths: [], hmacKey: 'k' }

beforeEach(() => {
  h.calls.length = 0
  h.result = { stdout: '', timedOut: false }
  h.hideRuntime = false
})

describe('exports de Vitest', () => {
  it('conditions imbriquées résolues ; entrée absente : erreur', () => {
    expect(exportEntry({ default: { import: './a.js' } })).toBe('./a.js')
    expect(() => exportEntry({ require: './a.cjs' })).toThrow('entrée exports introuvable')
    expect(() => exportEntry(null)).toThrow('entrée exports introuvable')
  })
})

describe('rapport JSON de Vitest', () => {
  it('JSON invalide : null', () => {
    expect(parseVitestReport('{"testResults": [}', '/p')).toBeNull()
  })
  it('statuts ignorés et inconnus', () => {
    const r = parseVitestReport(
      JSON.stringify({
        testResults: [
          {
            name: '/p/a.test.ts',
            assertionResults: [
              { fullName: 't', status: 'todo' },
              { fullName: 't', status: 'weird', duration: 4 },
            ],
          },
        ],
      }),
      '/p',
    )
    expect(r?.map((t) => [t.status, t.durationMs])).toEqual([
      ['skipped', null],
      ['other', 4],
    ])
  })
})

describe('détection Vitest', () => {
  it('vitest installé : version lue', async () => {
    expect(await new VitestAdapter().detect(dir(FAKE_VITEST))).toMatchObject({
      detected: true,
      version: '3.0.1',
    })
  })
  it('vitest absent : RUNNER_NOT_FOUND', async () => {
    expect(await new VitestAdapter().detect(dir())).toEqual({
      detected: false,
      framework: 'vitest',
      version: null,
      nativeEsm: false,
      reasons: ['RUNNER_NOT_FOUND'],
    })
  })
})

describe('lancement Vitest (runner simulé)', () => {
  it('run() avant prepare() : erreur', async () => {
    await expect(
      new VitestAdapter().run({ mode: 'observe', runDir: dir(), timeoutMs: 1 }),
    ).rejects.toThrow('prepare()')
  })

  async function prepared(over: Record<string, unknown> = {}) {
    const root = dir(FAKE_VITEST)
    const tmp = dir()
    const a = new VitestAdapter()
    await a.prepare({ root, tmpDir: tmp, runId: 'r1', include: [], exclude: [], redact, ...over })
    return { a, root, tmp }
  }

  it('sans config, env, cwd ni NODE_OPTIONS ; runtime introuvable : chemin par défaut', async () => {
    const saved = process.env['NODE_OPTIONS']
    delete process.env['NODE_OPTIONS']
    try {
      const { a, root, tmp } = await prepared()
      expect(readFileSync(join(tmp, 'varia-setup.mjs'), 'utf8')).toContain(
        'node_modules/vitest/dist/index.js',
      )
      h.hideRuntime = true
      const runDir = dir()
      const run = await a.run({ mode: 'observe', runDir, timeoutMs: 5 })
      const call = h.calls[0]
      expect(call?.args[0]).toMatch(/vitest[\\/]runtime[\\/]run-vitest\.mjs$/)
      expect(call?.opts['cwd']).toBe(root)
      expect((call?.opts['env'] as NodeJS.ProcessEnv)['NODE_OPTIONS']).toBeUndefined()
      const params = JSON.parse(readFileSync(join(runDir, 'vitest-params.json'), 'utf8')) as {
        configFile: unknown
      }
      expect(params.configFile).toBeNull()
      expect(run.tests).toBeNull()
    } finally {
      if (saved !== undefined) process.env['NODE_OPTIONS'] = saved
    }
  })

  it('env du projet puis de l’exécution, cwd fourni ; délai dépassé : aucun test', async () => {
    const { a } = await prepared({ env: { A: '1', B: '1' }, cwd: '/ailleurs' })
    h.result = { stdout: '{"testResults":[]}', timedOut: true }
    const run = await a.run({ mode: 'observe', runDir: dir(), timeoutMs: 5, env: { B: '2' } })
    const env = h.calls[0]?.opts['env'] as NodeJS.ProcessEnv
    expect([env['A'], env['B']]).toEqual(['1', '2'])
    expect(h.calls[0]?.opts['cwd']).toBe('/ailleurs')
    expect(run.tests).toBeNull()
  })
})
