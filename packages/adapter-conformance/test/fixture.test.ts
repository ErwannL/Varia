// Fichiers du projet de conformité selon le dialecte (extension R-01 : suffixe d'import ESM natif).
import { conformanceFiles } from '@varia/adapter-conformance'
import { describe, expect, it } from 'vitest'

describe('dialecte du projet de conformité', () => {
  it('ESM : import sans extension par défaut, suffixe ajouté si demandé (ESM natif de Node)', () => {
    const plain = conformanceFiles({ module: 'esm', ext: 'js' })['tests/conformance.test.js']
    expect(plain).toContain("from '../src/conformance'\n")
    const native = conformanceFiles({ module: 'esm', ext: 'js', importSuffix: '.js' })[
      'tests/conformance.test.js'
    ]
    expect(native).toContain("from '../src/conformance.js'\n")
  })
  it('autre langage : fichiers fournis par le dialecte, utilisés tels quels (R-02)', () => {
    const files = { 'src/conformance.py': 'def greet(u): ...\n' }
    expect(conformanceFiles({ module: 'cjs', ext: 'py', files })).toBe(files)
  })
})
