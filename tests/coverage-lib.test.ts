import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  addCounts,
  neverExecuted,
  convertRaw,
  evaluateCoverage,
  exactCounts,
  globToRegExp,
  isPackageSource,
  isVariaFile,
  mergeChildren,
  pruneChildCoverage,
} from '../scripts/coverage-lib.mjs'

// Racine absolue de la plateforme (`/r`, ou `D:\r` sous Windows) : URL et chemins natifs cohérents.
const R = resolve('/r')
const abs = (rel: string) => join(R, rel)
const u = (rel: string) => pathToFileURL(abs(rel)).href

const loc = (line: number) => ({ start: { line, column: 0 }, end: { line, column: 5 } })
const fc = (path: string, s: number[], b: number[][] = [], f: number[] = []) => ({
  path,
  statementMap: Object.fromEntries(s.map((_, i) => [String(i), loc(i + 1)])),
  fnMap: Object.fromEntries(f.map((_, i) => [String(i), { name: `f${i}`, loc: loc(1) }])),
  branchMap: Object.fromEntries(
    b.map((x, i) => [String(i), { loc: loc(1), locations: x.map(() => loc(1)) }]),
  ),
  s: Object.fromEntries(s.map((n, i) => [String(i), n])),
  f: Object.fromEntries(f.map((n, i) => [String(i), n])),
  b: Object.fromEntries(b.map((x, i) => [String(i), x])),
})

type Pair = [number, number]
const full: Record<string, Pair> = {
  statements: [2, 2],
  branches: [2, 2],
  functions: [1, 1],
  lines: [2, 2],
}
const cfg = (over: object = {}) => ({
  thresholds: [
    { pattern: 'packages/**', statements: 100, branches: 100, functions: 100, lines: 100 },
  ],
  required: [],
  excluded: {},
  ...over,
})

describe('globToRegExp / isPackageSource / isVariaFile', () => {
  it('traduit ** et *', () => {
    expect(globToRegExp('packages/**').test('packages/a/b/c.ts')).toBe(true)
    expect(globToRegExp('packages/*/src/x.ts').test('packages/a/src/x.ts')).toBe(true)
    expect(globToRegExp('packages/*/src/x.ts').test('packages/a/b/src/x.ts')).toBe(false)
    expect(globToRegExp('a.b').test('axb')).toBe(false)
  })
  it('reconnaît le code livré des paquets', () => {
    expect(isPackageSource('packages/core/src/a.ts')).toBe(true)
    expect(isPackageSource('packages/core/runtime/s.cjs')).toBe(true)
    expect(isPackageSource('packages/dashboard/src/A.tsx')).toBe(true)
    expect(isPackageSource('packages/core/test/a.test.ts')).toBe(false)
    expect(isPackageSource('packages/core/src/a.d.ts')).toBe(false)
    expect(isPackageSource('packages/core/README.md')).toBe(false)
    expect(isPackageSource('scripts/a.mjs')).toBe(false)
  })
  it('ne retient que les fichiers file: de packages/, hors dist et node_modules', () => {
    const root = R
    expect(isVariaFile(u('packages/core/runtime/s.cjs'), root)).toBe(true)
    expect(isVariaFile(u('packages/adapters/vitest/runtime/p.mjs'), root)).toBe(true)
    expect(isVariaFile(u('packages/core/src/a.ts'), root)).toBe(false)
    expect(isVariaFile(u('packages/cli/dist/main.js'), root)).toBe(false)
    expect(isVariaFile(u('packages/x/node_modules/y.js'), root)).toBe(false)
    expect(isVariaFile(u('packages/x/test/y.js'), root)).toBe(false)
    expect(isVariaFile(u('scripts/y.js'), root)).toBe(false)
    expect(isVariaFile(abs('packages/probe-runtime/runtime/probe.cjs'), root)).toBe(false)
    expect(isVariaFile('node:fs', root)).toBe(false)
  })
})

describe('exactCounts / addCounts', () => {
  it('compte couverts / total par axe, lignes à la manière d’istanbul', () => {
    const c = exactCounts(fc('x', [1, 0, 3], [[1, 0]], [0, 2]))
    expect(c).toEqual({
      statements: [2, 3],
      branches: [1, 2],
      functions: [1, 2],
      lines: [2, 3],
    })
  })
  it('additionne des structures identiques et refuse sinon', () => {
    const a = fc('x', [0, 1], [[0, 1]], [0])
    addCounts(a, fc('x', [1, 0], [[2, 0]], [3]))
    expect(a.s).toEqual({ 0: 1, 1: 1 })
    expect(a.b).toEqual({ 0: [2, 1] })
    expect(a.f).toEqual({ 0: 3 })
    expect(() => addCounts(a, fc('x', [1]))).toThrow(/fusion refusée/)
    expect(neverExecuted(fc('x', [0], [[0]], [0]))).toBe(true)
    expect(neverExecuted(fc('x', [0], [[0, 1]], [0]))).toBe(false)
    expect(neverExecuted(fc('x', [0], [], [1]))).toBe(false)
  })
})

describe('evaluateCoverage', () => {
  it('passe à 100 %', () => {
    expect(
      evaluateCoverage({ 'packages/a/src/x.ts': full }, cfg(), ['packages/a/src/x.ts']),
    ).toEqual([])
  })
  it('juge le compte exact, jamais l’arrondi', () => {
    const almost = { ...full, branches: [1999, 2000] as Pair }
    const f = evaluateCoverage({ 'packages/a/src/x.ts': almost }, cfg(), [])
    expect(f).toEqual(['packages/a/src/x.ts : branches 1999/2000 sous le seuil 100 %'])
  })
  it('signale un fichier sans seuil, un requis non mesuré, un source oublié, une exclusion sans raison', () => {
    const f = evaluateCoverage(
      { 'other/x.ts': full, 'packages/p/runtime/r.cjs': { ...full, statements: [0, 2] as Pair } },
      cfg({
        required: ['packages/p/runtime/r.cjs', 'packages/p/runtime/absent.cjs'],
        excluded: { 'packages/e.ts': ' ' },
      }),
      ['packages/a/src/oublie.ts', 'packages/e.ts', 'packages/a/test/t.test.ts'],
    )
    expect(f).toEqual([
      "other/x.ts : aucun seuil ne s'applique",
      'packages/p/runtime/r.cjs : statements 0/2 sous le seuil 100 %',
      "packages/p/runtime/r.cjs : fichier d'exécution non mesuré (0 instruction couverte)",
      "packages/p/runtime/absent.cjs : fichier d'exécution non mesuré (0 instruction couverte)",
      'packages/a/src/oublie.ts : ni mesuré ni exclu explicitement (coverage-thresholds.json)',
      'packages/e.ts : exclusion sans raison',
    ])
  })
  it('accepte un fichier exclu avec raison', () => {
    expect(
      evaluateCoverage({}, cfg({ excluded: { 'packages/a/src/g.ts': 'code généré' } }), [
        'packages/a/src/g.ts',
      ]),
    ).toEqual([])
  })
})

describe('couverture des processus enfants', () => {
  const root = R
  const raw = (urls: string[]) =>
    JSON.stringify({ result: urls.map((url) => ({ url, functions: [{ ranges: [] }] })) })
  it('réduit les dépôts aux fichiers de Varia et supprime le reste', () => {
    const dir = mkdtempSync(join(tmpdir(), 'varia-cc-'))
    writeFileSync(join(dir, 'coverage-1.json'), raw([u('packages/a/runtime/s.cjs'), 'node:fs']))
    writeFileSync(join(dir, 'coverage-2.json'), raw([u('node_modules/x.js')]))
    writeFileSync(join(dir, 'coverage-3.json'), '{"result": [')
    writeFileSync(join(dir, 'autre.txt'), '')
    expect(pruneChildCoverage(dir, root)).toBe(1)
    expect(readdirSync(dir).sort()).toEqual(['autre.txt', 'coverage-3.json', 'kept-1.json'])
    expect(pruneChildCoverage(join(dir, 'absent'), root)).toBe(0)
  })
  it('fusionne les exécutions des enfants puis la carte du processus de test', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'varia-cc-'))
    writeFileSync(join(dir, 'coverage-1.json'), raw([u('packages/a/runtime/s.cjs')]))
    writeFileSync(
      join(dir, 'coverage-2.json'),
      raw([u('packages/a/runtime/s.cjs'), u('packages/b/runtime/t.cjs')]),
    )
    let n = 0
    const convert = async (file: string) => {
      n++
      return fc(file, n === 1 ? [1, 0] : [0, 1])
    }
    const map: Record<string, ReturnType<typeof fc>> = {
      // Entrées de Vitest (source transformée, positions fausses) : remplacées.
      [abs('packages/a/runtime/s.cjs')]: fc(abs('packages/a/runtime/s.cjs'), [7, 7, 7]),
      [abs('packages/b/runtime/t.cjs')]: fc(abs('packages/b/runtime/t.cjs'), [0, 0, 0]),
      // Fichier d'exécution jamais exécuté : conservé tel quel ; code TypeScript : non concerné.
      [abs('packages/c/runtime/u.cjs')]: fc(abs('packages/c/runtime/u.cjs'), [0]),
      [abs('packages/c/src/v.ts')]: fc(abs('packages/c/src/v.ts'), [3]),
    }
    const merged = await mergeChildren(map, dir, root, convert)
    expect(merged).toEqual([abs('packages/a/runtime/s.cjs'), abs('packages/b/runtime/t.cjs')])
    expect(
      exactCounts(map[abs('packages/a/runtime/s.cjs')] as ReturnType<typeof fc>).statements,
    ).toEqual([2, 2])
    expect(map[abs('packages/a/runtime/s.cjs')]?.s).toEqual({ 0: 1, 1: 1 })
    expect(map[abs('packages/c/src/v.ts')]?.s).toEqual({ 0: 3 })
    expect(Object.keys(map[abs('packages/b/runtime/t.cjs')]?.s ?? {})).toHaveLength(2)
    expect(await mergeChildren({}, join(dir, 'absent'), root, convert)).toEqual([])
    // Exécuté (compteurs non nuls) sans couverture brute : chargé par Vite, mesure refusée.
    const viaVite = { [abs('packages/c/runtime/u.cjs')]: fc(abs('packages/c/runtime/u.cjs'), [1]) }
    await expect(mergeChildren(viaVite, join(dir, 'absent'), root, convert)).rejects.toThrow(
      /mesure non fiable/,
    )
  })
  it('convertit une couverture V8 brute réelle avec le convertisseur AST de Vitest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'varia-cc-'))
    const file = join(dir, 'm.cjs')
    const code = 'function a(x) {\n  if (x) return 1\n  return 2\n}\nmodule.exports = a\n'
    writeFileSync(file, code)
    const functions = [
      {
        functionName: '',
        isBlockCoverage: true,
        ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }],
      },
      {
        functionName: 'a',
        isBlockCoverage: true,
        ranges: [{ startOffset: 0, endOffset: 44, count: 0 }],
      },
    ]
    const data = await convertRaw(file, functions)
    expect(data.path).toBe(file)
    expect(exactCounts(data).functions).toEqual([0, 1])
    expect(pathToFileURL(file).href.startsWith('file://')).toBe(true)
  })
})
