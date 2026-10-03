// E-03 (CDC §10.10) : cibles remplacées par un mock déclaré dans un fichier de test (`jest.mock`,
// `vi.mock`…). Détection statique et déterministe : « déclarée mockée par le test », jamais devinée.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mockedTargets, mockSpecifiers } from '../src/mocks.js'

describe('mockSpecifiers', () => {
  it('jest.mock, jest.doMock, vi.mock, vi.doMock, unstable_mockModule ; guillemets variés', () => {
    const src = [
      "jest.mock('../src/users')",
      'jest.doMock("./a", () => ({}))',
      'vi.mock(`../src/b.ts`)',
      "vi.doMock( '../c' )",
      "jest.unstable_mockModule('../d.mjs', () => ({}))",
      "jest.requireActual('../src/users')",
      'mock("../nope")',
    ].join('\n')
    expect(mockSpecifiers(src)).toEqual(['../src/users', './a', '../src/b.ts', '../c', '../d.mjs'])
  })
})

// Chemins natifs de la plateforme (« \\ » sous Windows), comme ceux que construit le code.
const P = (rel: string) => join('/p', rel)

describe('mockedTargets', () => {
  const files = new Set([
    P('src/users.js'),
    P('src/b.ts'),
    P('src/lib/index.ts'),
    P('vendor/x.js'),
    P('src/gen/out.js'),
  ])
  const sources: Record<string, string> = {
    [P('tests/a.test.js')]:
      "jest.mock('../src/users')\njest.mock('../src/lib')\njest.mock('lodash')\njest.mock('../vendor/x')",
    [P('tests/b.test.ts')]:
      "vi.mock('../src/b')\nvi.mock('../src/absent')\nvi.mock('../src/gen/out')",
  }
  const io = {
    read: (abs: string) => sources[abs] ?? null,
    isFile: (abs: string) => files.has(abs),
  }
  it('résout les chemins relatifs, garde les cibles du projet (include/exclude), trie', () => {
    expect(
      mockedTargets(
        '/p',
        ['tests/b.test.ts', 'tests/a.test.js', 'tests/a.test.js', 'tests/illisible.test.js'],
        { include: ['src/**'], exclude: ['src/gen/**'] },
        io,
      ),
    ).toEqual([
      { module: 'src/b.ts', testFile: 'tests/b.test.ts' },
      { module: 'src/lib/index.ts', testFile: 'tests/a.test.js' },
      { module: 'src/users.js', testFile: 'tests/a.test.js' },
    ])
  })
  it('même module mocké par plusieurs fichiers : une entrée par fichier, triée', () => {
    const many = { read: () => "jest.mock('../src/users')", isFile: io.isFile }
    expect(
      mockedTargets(
        '/p',
        ['tests/z.test.js', 'tests/a.test.js', 'tests/m.test.js'],
        {
          include: ['src/**'],
          exclude: [],
        },
        many,
      ).map((t) => t.testFile),
    ).toEqual(['tests/a.test.js', 'tests/m.test.js', 'tests/z.test.js'])
  })
  it('système de fichiers réel : fichier de test lu, cible résolue sur disque', () => {
    const d = mkdtempSync(join(tmpdir(), 'varia-mocks-'))
    mkdirSync(join(d, 'src'))
    mkdirSync(join(d, 'tests'))
    writeFileSync(join(d, 'src', 'a.js'), '')
    writeFileSync(join(d, 'tests', 'a.test.js'), "jest.mock('../src/a')\njest.mock('../src')")
    expect(mockedTargets(d, ['tests/a.test.js'], { include: ['src/**'], exclude: [] })).toEqual([
      { module: 'src/a.js', testFile: 'tests/a.test.js' },
    ])
  })
  it('système de fichiers réel par défaut : fichier absent ⇒ aucune entrée', () => {
    expect(
      mockedTargets('/nonexistent-root', ['t.test.js'], { include: ['**'], exclude: [] }),
    ).toEqual([])
  })
})
