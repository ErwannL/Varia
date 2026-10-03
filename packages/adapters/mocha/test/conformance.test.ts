// Suite de conformité d'adapter (CDC §9.3) contre l'adapter Mocha RÉEL, sur un projet jetable construit
// à partir de examples/mocha-project (Mocha installé). Mocha n'a ni `test.each` ni `expect` : le dialecte
// les définit en tête du fichier de test (bdd + node:assert), sans rien changer à la suite.
import { runConformance } from '@varia/adapter-conformance'
import { MochaAdapter } from '@varia/adapter-mocha'
import { copyFileSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Équivalents Mocha de `test`, `test.each` et `expect` (sous-ensemble utilisé par la suite). */
const HELPERS = [
  'const test = (name, fn) => it(name, fn)',
  "test.each = (rows) => (title, fn) => rows.forEach((row) => it(title.replace('%i', String(row[0])), () => fn(...row)))",
  'const expect = (v) => ({',
  '  toBe: (e) => assert.strictEqual(v, e),',
  '  toEqual: (e) => assert.deepStrictEqual(v, e),',
  '  toThrow: (m) => assert.throws(v, (err) => String(err.message).includes(m)),',
  '  resolves: { toEqual: async (e) => assert.deepStrictEqual(await v, e) },',
  '})',
]
const MOCHA_PRELUDE = ["const assert = require('node:assert')", ...HELPERS].join('\n')
const EXAMPLE = resolve('examples/mocha-project')

/** Variante ESM natif de l'exemple, hors du dépôt : `"type": "module"`, Mocha de l'exemple (lien). */
function esmExample(): string {
  const d = mkdtempSync(join(tmpdir(), 'varia-mocha-esm-example-'))
  const pkg = JSON.parse(readFileSync(join(EXAMPLE, 'package.json'), 'utf8')) as object
  writeFileSync(join(d, 'package.json'), JSON.stringify({ ...pkg, type: 'module' }))
  copyFileSync(join(EXAMPLE, '.mocharc.json'), join(d, '.mocharc.json'))
  symlinkSync(join(EXAMPLE, 'node_modules'), join(d, 'node_modules'), 'junction')
  return d
}

describe('conformité de l’adapter Mocha', () => {
  it('Mocha (CommonJS) passe toutes les vérifications', async () => {
    const r = await runConformance({
      adapter: new MochaAdapter(),
      example: EXAMPLE,
      dialect: { module: 'cjs', ext: 'js', testImport: MOCHA_PRELUDE },
    })
    expect(r.checks.filter((c) => c.status !== 'PASS')).toEqual([])
    expect(r.checks).toHaveLength(9)
  })
  it('Mocha (ESM natif, crochets module.register) passe toutes les vérifications', async () => {
    const r = await runConformance({
      adapter: new MochaAdapter(),
      example: esmExample(),
      dialect: {
        module: 'esm',
        ext: 'js',
        importSuffix: '.js',
        testImport: ["import assert from 'node:assert'", ...HELPERS].join('\n'),
      },
    })
    expect(r.checks.filter((c) => c.status !== 'PASS')).toEqual([])
    expect(r.checks).toHaveLength(9)
  })
})
