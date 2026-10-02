// Tests unitaires de l'adapter Jest : configuration, détection, rapport et lancement (runner simulé).
import { mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: string[]; opts: Record<string, unknown> }[],
  result: { stdout: '', timedOut: false } as Record<string, unknown>,
  hideSrcTransform: false,
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
    h.hideSrcTransform && p.replace(/\\/g, '/').endsWith('jest/runtime/transform.cjs')
      ? false
      : fs.existsSync(p)
  return { ...fs, existsSync, default: { ...fs, existsSync } }
})

const { JestAdapter, parseJestReport } = await import('../src/adapter.js')
const { applyPreset, generateJestConfig, loadProjectJestConfig } = await import('../src/config.js')

function dir(files: Record<string, string> = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'varia-jest-'))
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(d, f, '..'), { recursive: true })
    writeFileSync(join(d, f), c)
  }
  return d
}
const FAKE_JEST = {
  'node_modules/jest/package.json': '{"name":"jest","version":"29.1.0"}',
  'node_modules/jest/bin/jest.js': '',
}
const redact = { fields: [], patterns: [], skipPaths: [], hmacKey: 'k' }

beforeEach(() => {
  h.calls.length = 0
  h.result = { stdout: '', timedOut: false }
  h.hideSrcTransform = false
})

describe('configuration Jest du projet', () => {
  it('lit jest.config.json en priorité', async () => {
    const d = dir({ 'jest.config.json': '{"testEnvironment":"node"}', 'package.json': '{}' })
    expect(await loadProjectJestConfig(d)).toEqual({ testEnvironment: 'node' })
  })
  it('lit jest.config.js exportant un objet', async () => {
    const d = dir({ 'jest.config.mjs': 'export default { verbose: true }' })
    expect(await loadProjectJestConfig(d)).toEqual({ verbose: true })
  })
  it('lit jest.config.js exportant une fonction asynchrone', async () => {
    const d = dir({ 'jest.config.mjs': 'export default async () => ({ bail: 2 })' })
    expect(await loadProjectJestConfig(d)).toEqual({ bail: 2 })
  })
  it('jest.config sans export par défaut : configuration vide', async () => {
    const d = dir({ 'jest.config.mjs': 'export const x = 1' })
    expect(await loadProjectJestConfig(d)).toEqual({})
  })
  it('preset introuvable : erreur explicite', () => {
    const d = dir({ 'package.json': '{}' })
    expect(() => applyPreset(d, { preset: 'absent-preset' })).toThrow(
      'preset Jest introuvable : absent-preset',
    )
  })
  it('transform en tableau sans options : options d’origine vides', () => {
    const d = dir({ 'package.json': '{}', 'tr.cjs': 'module.exports = {}' })
    const c = generateJestConfig({
      root: d,
      project: { transform: { x: ['<rootDir>/tr.cjs'] } },
      transformPath: '/t.cjs',
      probePath: '/probe.cjs',
      include: [],
      exclude: [],
      cacheDirectory: '/c',
      salt: 's',
    })
    const entry = (c['transform'] as Record<string, [string, Record<string, unknown>]>)['x']
    expect(entry?.[1]['originalConfig']).toEqual({})
    expect(entry?.[1]['original']).toBe(join(realpathSync(d), 'tr.cjs'))
  })
  it('transformeur introuvable depuis le projet : résolu depuis jest-config (babel-jest implicite)', () => {
    const d = dir({
      'package.json': '{}',
      'node_modules/jest-config/package.json': '{"name":"jest-config","main":"index.js"}',
      'node_modules/jest-config/index.js': '',
      'node_modules/jest-config/node_modules/tr-interne/package.json':
        '{"name":"tr-interne","main":"index.js"}',
      'node_modules/jest-config/node_modules/tr-interne/index.js': '',
    })
    const c = generateJestConfig({
      root: d,
      project: { transform: { x: 'tr-interne' } },
      transformPath: '/t.cjs',
      probePath: '/probe.cjs',
      include: [],
      exclude: [],
      cacheDirectory: '/c',
      salt: 's',
    })
    const entry = (c['transform'] as Record<string, [string, Record<string, unknown>]>)['x']
    expect(entry?.[1]['original']).toBe(
      join(
        realpathSync(d),
        'node_modules',
        'jest-config',
        'node_modules',
        'tr-interne',
        'index.js',
      ),
    )
  })
})

describe('rapport JSON de Jest', () => {
  it('JSON invalide : null', () => {
    expect(parseJestReport('{"testResults": [', '/p')).toBeNull()
  })
  it('statuts ignorés et inconnus', () => {
    const r = parseJestReport(
      JSON.stringify({
        testResults: [
          {
            name: '/p/a.test.js',
            assertionResults: [
              { fullName: 't', status: 'pending' },
              { fullName: 't', status: 'disabled', duration: 3 },
            ],
          },
        ],
      }),
      '/p',
    )
    expect(r?.map((t) => [t.status, t.durationMs])).toEqual([
      ['skipped', null],
      ['other', 3],
    ])
    expect(r?.[0]?.testId).not.toBe(r?.[1]?.testId)
  })
})

describe('détection Jest', () => {
  it('sans package.json ni jest : non détecté, pas d’ESM natif', async () => {
    const r = await new JestAdapter().detect(dir())
    expect(r).toMatchObject({ detected: false, version: null, nativeEsm: false })
    expect(r.reasons).toEqual(['RUNNER_NOT_FOUND'])
  })
  it('configuration illisible : traitée comme absente (ESM natif signalé)', async () => {
    const r = await new JestAdapter().detect(
      dir({ ...FAKE_JEST, 'package.json': '{"type":"module"}', 'jest.config.json': '{oops' }),
    )
    expect(r).toMatchObject({ detected: true, version: '29.1.0', nativeEsm: true })
    expect(r.reasons).toEqual(['NATIVE_ESM'])
  })
  it('type module avec babel mais transform vide : ESM natif', async () => {
    const r = await new JestAdapter().detect(
      dir({
        ...FAKE_JEST,
        'package.json': '{"type":"module","jest":{"transform":{}}}',
        '.babelrc': '{}',
      }),
    )
    expect(r.nativeEsm).toBe(true)
  })
})

describe('détection Jest (suite)', () => {
  it('type module sans babel ni transform déclaré : ESM natif', async () => {
    const r = await new JestAdapter().detect(
      dir({ ...FAKE_JEST, 'package.json': '{"type":"module","jest":{}}' }),
    )
    expect(r).toMatchObject({ detected: true, nativeEsm: true, reasons: ['NATIVE_ESM'] })
  })
})

describe('lancement Jest (runner simulé)', () => {
  it('run() avant prepare() : erreur', async () => {
    await expect(
      new JestAdapter().run({ mode: 'observe', runDir: dir(), timeoutMs: 1 }),
    ).rejects.toThrow('prepare()')
  })

  async function prepared(over: Record<string, unknown> = {}) {
    const root = dir({ ...FAKE_JEST, 'package.json': '{"jest":{"transform":{}}}' })
    const tmp = dir()
    const a = new JestAdapter()
    await a.prepare({
      root,
      tmpDir: tmp,
      runId: 'r1',
      include: ['src/**'],
      exclude: [],
      redact,
      ...over,
    })
    return { a, root, tmp }
  }

  it('sans env, cwd ni NODE_OPTIONS : racine du projet, NODE_OPTIONS absent', async () => {
    const saved = process.env['NODE_OPTIONS']
    delete process.env['NODE_OPTIONS']
    try {
      const { a, root } = await prepared()
      h.result = { stdout: 'pas de json', timedOut: false }
      const run = await a.run({ mode: 'observe', runDir: dir(), timeoutMs: 5 })
      const call = h.calls[0]
      expect(call?.opts['cwd']).toBe(root)
      expect((call?.opts['env'] as NodeJS.ProcessEnv)['NODE_OPTIONS']).toBeUndefined()
      expect(run.tests).toBeNull()
      expect(run.coverage).toBeUndefined()
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

  it('transform source absent : repli sur le transform publié', async () => {
    h.hideSrcTransform = true
    const { tmp } = await prepared()
    const cfg = JSON.parse(readFileSync(join(tmp, 'jest.config.json'), 'utf8')) as {
      transform: Record<string, unknown>
    }
    expect(cfg.transform).toEqual({})
    // Le repli ne change rien quand aucun transform n'est déclaré : vérifier avec un transform.
    const root = dir({ ...FAKE_JEST, 'package.json': '{}', 'tr.cjs': '' })
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ jest: { transform: { x: '<rootDir>/tr.cjs' } } }),
    )
    const t2 = dir()
    await new JestAdapter().prepare({
      root,
      tmpDir: t2,
      runId: 'r',
      include: [],
      exclude: [],
      redact,
    })
    const c2 = JSON.parse(readFileSync(join(t2, 'jest.config.json'), 'utf8')) as {
      transform: Record<string, [string]>
    }
    const { TRANSFORM_PATH } = await import('../src/adapter.js')
    expect(c2.transform['x']?.[0]).toBe(TRANSFORM_PATH)
  })
})
