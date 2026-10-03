// Projet de conformité (CDC §9.3) : une cible et ses tests, identiques pour tout runner ; seul le
// « dialecte » (système de modules, extensions, import des fonctions de test) change.

/** Forme des fichiers de test attendue par le runner de l'adapter. */
export interface ConformanceDialect {
  /** `cjs` : `module.exports` / `require` ; `esm` : `export` / `import`. */
  module: 'cjs' | 'esm'
  /** Extension des fichiers (`js`, `ts`, …), qui doivent correspondre au motif de tests du projet. */
  ext: string
  /** Ligne d'import des fonctions de test (`test`, `expect`), si elles ne sont pas globales. */
  testImport?: string
}

/** Fichier de la cible et du test, relatifs au projet. */
export const targetFile = (d: ConformanceDialect) => `src/conformance.${d.ext}`
export const testFile = (d: ConformanceDialect) => `tests/conformance.test.${d.ext}`

/** Noms des tests de conformité (sans `describe` : le nom complet est le même pour tout runner). */
export const TESTS = {
  observe: 'conformance observe',
  async: 'conformance async',
  multiple: 'conformance multiple',
  throw: 'conformance throw',
  param: (n: number) => `conformance param ${String(n)}`,
} as const

const EXPORTS = ['ConformanceError', 'greet', 'fetchLater', 'add', 'fail', 'double']

const TARGET = `class ConformanceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConformanceError'
  }
}
function greet(user) {
  return 'Hello ' + user.name
}
async function fetchLater(id) {
  await Promise.resolve()
  return { id }
}
function add(a, b) {
  return a + b
}
function fail(message) {
  throw new ConformanceError(message)
}
function double(n) {
  return n * 2
}
`

const TEST = `test('${TESTS.observe}', () => {
  expect(greet({ name: 'Ada' })).toBe('Hello Ada')
})
test('${TESTS.async}', async () => {
  await expect(fetchLater(7)).resolves.toEqual({ id: 7 })
})
test('${TESTS.multiple}', () => {
  expect([add(1, 2), add(3, 4), add(5, 6)]).toEqual([3, 7, 11])
})
test('${TESTS.throw}', () => {
  expect(() => fail('refus')).toThrow('refus')
})
test.each([[1], [2]])('conformance param %i', (n) => {
  expect(double(n)).toBe(n * 2)
})
`

/** Fichiers (chemin relatif → contenu) du projet de conformité dans le dialecte donné. */
export function conformanceFiles(d: ConformanceDialect): Record<string, string> {
  const names = EXPORTS.join(', ')
  const target =
    d.module === 'cjs'
      ? `${TARGET}module.exports = { ${names} }\n`
      : `${TARGET}export { ${names} }\n`
  const imports =
    d.module === 'cjs'
      ? `const { ${names} } = require('../src/conformance')\n`
      : `import { ${names} } from '../src/conformance'\n`
  return {
    [targetFile(d)]: target,
    [testFile(d)]: `${d.testImport !== undefined ? d.testImport + '\n' : ''}${imports}\n${TEST}`,
  }
}
