import { readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { globToRegExpSource } from './glob.js'

/**
 * Cibles remplacées par un mock (CDC §10.10, E-03). Un module mocké n'est jamais exécuté : la sonde ne
 * peut pas l'observer dans ce fichier de test. Détection STATIQUE des appels `jest.mock`, `jest.doMock`,
 * `jest.unstable_mockModule`, `vi.mock`, `vi.doMock` à spécificateur littéral : le rapport dit « déclarée
 * mockée par le test » — un mock construit autrement (chemin calculé, moduleNameMapper) n'est pas vu.
 */
const MOCK_CALL = /\b(?:jest|vi)\.(?:mock|doMock|unstable_mockModule)\(\s*(['"`])([^'"`]+)\1/g

export function mockSpecifiers(source: string): string[] {
  return [...source.matchAll(MOCK_CALL)].map((m) => m[2] as string)
}

export interface MockedTarget {
  module: string
  testFile: string
}

interface FileAccess {
  read(abs: string): string | null
  isFile(abs: string): boolean
}

const realFiles: FileAccess = {
  read: (abs) => {
    try {
      return readFileSync(abs, 'utf8')
    } catch {
      return null
    }
  },
  isFile: (abs) => statSync(abs, { throwIfNoEntry: false })?.isFile() === true,
}

const EXTENSIONS = ['', '.js', '.cjs', '.mjs', '.ts', '.cts', '.mts', '.jsx', '.tsx']
/** Fichier exact ou avec extension, puis `index.*` du dossier (séparateurs natifs : `join`). */
const candidates = (base: string) => [
  ...EXTENSIONS.map((e) => base + e),
  ...EXTENSIONS.slice(1).map((e) => join(base, `index${e}`)),
]

/** Modules du projet (relatifs, POSIX) mockés par chaque fichier de test ; triés, sans doublon. */
export function mockedTargets(
  root: string,
  testFiles: string[],
  targets: { include: string[]; exclude: string[] },
  io: FileAccess = realFiles,
): MockedTarget[] {
  const re = (globs: string[]) => globs.map((g) => new RegExp(globToRegExpSource(g)))
  const [inc, exc] = [re(targets.include), re(targets.exclude)]
  const found = new Map<string, MockedTarget>()
  for (const testFile of new Set(testFiles)) {
    const source = io.read(join(root, testFile))
    if (source === null) continue
    for (const spec of mockSpecifiers(source)) {
      if (!spec.startsWith('.')) continue
      const base = join(root, dirname(testFile), spec)
      const file = candidates(base).find((f) => io.isFile(f))
      if (file === undefined) continue
      const module = relative(root, file).split(sep).join('/')
      if (!inc.some((r) => r.test(module)) || exc.some((r) => r.test(module))) continue
      found.set(`${module}\0${testFile}`, { module, testFile })
    }
  }
  return [...found.values()].sort((a, b) =>
    a.module === b.module ? (a.testFile < b.testFile ? -1 : 1) : a.module < b.module ? -1 : 1,
  )
}
