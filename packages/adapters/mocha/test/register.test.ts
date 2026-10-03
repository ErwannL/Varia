// Tests EN PROCESSUS du module d'injection Mocha (runtime/register.cjs, R-01) : crochet de chargement
// CommonJS et crochets racine, avec un `Module` et une sonde factices (aucun effet sur ce processus).
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type RegisterModule = typeof import('../runtime/register.cjs')
const R = createRequire(import.meta.url)('../runtime/register.cjs') as RegisterModule

const root = join('/', 'p')
const cfg = { projectRoot: root, include: ['^src/'], exclude: ['^src/gen/'] }

/** `Module` factice : chaque chargeur pose `module.exports` à partir du nom du fichier. */
function fakeModule() {
  const loads: string[] = []
  const load = (ext: string) =>
    function (this: unknown, module: { exports: unknown }, filename: string) {
      loads.push(`${ext} ${filename}`)
      module.exports = { f: () => filename }
    }
  return { loads, Module: { _extensions: { '.js': load('.js'), '.cjs': load('.cjs') } } }
}

describe('ciblage', () => {
  it('include / exclude sur le chemin relatif ; hors projet et node_modules exclus', () => {
    const t = R.targeting(cfg)
    expect(t(join(root, 'src', 'a.js'))).toBe('src/a.js')
    expect(t(join(root, 'src', 'gen', 'a.js'))).toBeNull()
    expect(t(join(root, 'lib', 'a.js'))).toBeNull()
    expect(t(join(root, 'src', 'node_modules', 'x.js'))).toBeNull()
    expect(t(join('/', 'q', 'src', 'a.js'))).toBeNull()
  })
})

describe('crochet de chargement CommonJS', () => {
  it('enveloppe les exports des seules cibles, pour .js et .cjs, après le chargeur d’origine', () => {
    const { loads, Module } = fakeModule()
    const wrapped: string[] = []
    const g = {
      __varia: {
        wrapExports: (m: unknown, id: string) => {
          wrapped.push(id)
          return { wrapped: m }
        },
      },
    }
    R.hookLoaders(Module, cfg, g)
    const m1 = { exports: {} as unknown }
    Module._extensions['.js'].call(null, m1, join(root, 'src', 'a.js'))
    expect(m1.exports).toEqual({ wrapped: { f: expect.any(Function) } })
    const m2 = { exports: {} as unknown }
    Module._extensions['.cjs'].call(null, m2, join(root, 'test', 'b.cjs'))
    expect(m2.exports).toEqual({ f: expect.any(Function) })
    expect(wrapped).toEqual(['src/a.js'])
    expect(loads).toEqual([
      `.js ${join(root, 'src', 'a.js')}`,
      `.cjs ${join(root, 'test', 'b.cjs')}`,
    ])
  })
  it('sonde absente (hors run Varia) ou incomplète : exports intacts', () => {
    for (const g of [{}, { __varia: null }, { __varia: { wrapExports: 1 } }]) {
      const { Module } = fakeModule()
      R.hookLoaders(Module, cfg, g)
      const m = { exports: {} as unknown }
      Module._extensions['.js'].call(null, m, join(root, 'src', 'a.js'))
      expect(Object.keys(m.exports as object)).toEqual(['f'])
    }
  })
})

describe('crochets racine de Mocha', () => {
  /** Sonde factice : garde les crochets reçus par `install`. */
  function fakeProbe() {
    const got: Record<string, unknown> = {}
    return {
      got,
      install: (h: Record<string, unknown>) => Object.assign(got, h),
    }
  }
  it('beforeEach lit this.currentTest (fichier, nom complet) puis appelle les crochets de la sonde', () => {
    const probe = fakeProbe()
    const proc = { pid: 1 } as unknown as NodeJS.Process
    const hooks = R.rootHooks(probe, proc)
    const got = probe.got as {
      beforeEach: (f: () => void) => void
      afterEach: (f: () => void) => void
      getState: () => { testPath: string; currentTestName: string }
      process: unknown
    }
    expect(got.process).toBe(proc)
    const seen: unknown[] = []
    got.beforeEach(() => seen.push(['avant', got.getState()]))
    got.afterEach(() => seen.push(['après', got.getState()]))
    expect(got.getState()).toEqual({ testPath: '', currentTestName: '' })
    hooks.beforeEach.call({ currentTest: { file: '/p/t.js', fullTitle: () => 'a b' } })
    hooks.afterEach()
    expect(got.getState()).toEqual({ testPath: '', currentTestName: '' })
    // Sans test courant (crochet hors test) : état vide, jamais d'exception.
    hooks.beforeEach.call({})
    expect(seen).toEqual([
      ['avant', { testPath: '/p/t.js', currentTestName: 'a b' }],
      ['après', { testPath: '/p/t.js', currentTestName: 'a b' }],
      ['avant', { testPath: '', currentTestName: '' }],
    ])
    // Test sans fichier (suite construite par programme) : chemin vide.
    hooks.beforeEach.call({ currentTest: { fullTitle: () => 'x' } })
    expect(got.getState()).toEqual({ testPath: '', currentTestName: 'x' })
  })
  it('start : crochet de chargement posé et crochets racine exposés à Mocha (mochaHooks)', () => {
    const { Module } = fakeModule()
    const before = Module._extensions['.js']
    const probe = fakeProbe()
    const out = R.start(Module, probe, cfg, process, {})
    expect(Module._extensions['.js']).not.toBe(before)
    expect(Object.keys(out.mochaHooks)).toEqual(['beforeEach', 'afterEach'])
    expect(probe.got['process']).toBe(process)
  })
  it('start : objet global par défaut (globalThis)', () => {
    const { Module } = fakeModule()
    R.start(Module, fakeProbe(), cfg, process)
    const m = { exports: {} as unknown }
    // globalThis.__varia est absent dans ce processus de test : exports intacts.
    Module._extensions['.js'].call(null, m, join(root, 'src', 'a.js'))
    expect(Object.keys(m.exports as object)).toEqual(['f'])
  })
})
