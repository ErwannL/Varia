// Tests EN PROCESSUS du plugin Vite et du lanceur Vitest de Varia (chargés par Node, jamais par Vite).
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const req = createRequire(import.meta.url)
const { variaPlugin } = req('../runtime/plugin.mjs') as typeof import('../runtime/plugin.mjs')
const R = req('../runtime/run-vitest.mjs') as typeof import('../runtime/run-vitest.mjs')

const root = '/p'
const plugin = variaPlugin({ root, include: ['^src/'], exclude: ['^src/gen/'] })
const transform = (code: string, id: string) =>
  (plugin.transform as (c: string, i: string) => { code: string } | null)(code, id)

describe('plugin Vite de Varia', () => {
  it('réécrit les seules cibles : extension, node_modules, hors projet, include / exclude', () => {
    expect(plugin.name).toBe('varia-probe')
    expect(plugin.enforce).toBe('pre')
    const out = transform('export function f(x) { return x }', '/p/src/a.ts?v=1')
    expect(out?.code).toContain('__varia')
    for (const id of [
      '/p/src/a.css',
      '/p/node_modules/src/a.js',
      '/q/src/a.js',
      '/p/lib/a.js',
      '/p/src/gen/a.js',
    ])
      expect(transform('export function f() {}', id)).toBeNull()
    expect(transform('const x = 1', '/p/src/b.js')).toBeNull()
  })
})

describe('lanceur Vitest', () => {
  it('résout l’entrée `exports` (chaîne, import, default imbriqués)', () => {
    expect(R.pick('./a.js')).toBe('./a.js')
    expect(R.pick({ import: { default: './b.mjs' } })).toBe('./b.mjs')
    expect(R.pick({ default: './c.js' })).toBe('./c.js')
  })
  it('trouve vitest/node dans la copie de Vitest DU PROJET', () => {
    const url = R.vitestNodeEntry(resolve('examples/vitest-project'))
    expect(
      url.startsWith(pathToFileURL(resolve('examples/vitest-project/node_modules/vitest')).href),
    ).toBe(true)
  })
  const params = {
    root: '/p',
    files: ['tests/a.test.ts'],
    configFile: null,
    setupFile: '/tmp/setup.mjs',
    include: ['^src/'],
    exclude: [],
    cacheDir: '/tmp/cache',
  }
  it('options : sans config ⇒ `config: false` ; filtre de nom, couverture, cache, plugin', () => {
    const a = R.vitestOptions(params)
    expect(a.cli).toMatchObject({
      root: '/p',
      config: false,
      run: true,
      coverage: { enabled: false },
    })
    expect('testNamePattern' in a.cli).toBe(false)
    expect(a.vite.cacheDir).toBe('/tmp/cache')
    expect(a.vite.plugins[0]?.name).toBe('varia-probe')
    const b = R.vitestOptions({
      ...params,
      configFile: '/p/vitest.config.ts',
      testNamePattern: '^x$',
      coverageDir: '/tmp/cov',
      coverageInclude: ['src/**'],
    })
    expect(b.cli).toMatchObject({
      config: '/p/vitest.config.ts',
      testNamePattern: '^x$',
      coverage: { enabled: true, reportsDirectory: '/tmp/cov', include: ['src/**'] },
    })
  })
  it('runVitest : charge vitest/node du projet, lance, ferme (fermeture absente tolérée)', async () => {
    const seen: unknown[] = []
    let closed = false
    await R.runVitest({ ...params, root: resolve('examples/vitest-project') }, async (url) => {
      seen.push(url)
      return {
        startVitest: async (...args: unknown[]) => {
          seen.push(args[0], args[1])
          return { close: async () => void (closed = true) }
        },
      }
    })
    expect(seen.slice(1)).toEqual(['test', ['tests/a.test.ts']])
    expect(closed).toBe(true)
    await R.runVitest({ ...params, root: resolve('examples/vitest-project') }, async () => ({
      startVitest: async () => undefined,
    }))
  })
})
