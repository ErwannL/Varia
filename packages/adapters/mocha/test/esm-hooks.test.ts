// Tests EN PROCESSUS des crochets de chargement ESM (runtime/esm-hooks.mjs, chargé par Node, jamais
// par Vite) : ciblage, chargement paresseux de la réécriture, crochet `load` (chaîne ou octets).
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

type HooksModule = typeof import('../runtime/esm-hooks.mjs')
const H = createRequire(import.meta.url)('../runtime/esm-hooks.mjs') as HooksModule

const root = join('/', 'p')
const cfg = { projectRoot: root, include: ['^src/'], exclude: [], rewritePath: '' }
const url = (...p: string[]) => pathToFileURL(join(root, ...p)).href

/** Réécriture factice écrite sur disque (comme rewrite.mjs) : marque le code et l'identifiant. */
function fakeRewrite(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'varia-esm-hooks-')), 'rewrite.mjs')
  writeFileSync(
    file,
    'export function rewriteExports(code, file, id) { return code.includes("export") ? { code: code + "//" + id } : null }\n',
  )
  return file
}

describe('réécriture des modules ESM ciblés', () => {
  it('cibles seules ; URL non file: ignorée ; réécriture chargée une seule fois, au premier module ciblé', async () => {
    let loads = 0
    const rw = H.makeRewriter(cfg, () => {
      loads++
      return Promise.resolve((code: string, _f: string, id: string) =>
        code === '' ? null : { code: `${code}|${id}` },
      )
    })
    expect(await rw('node:fs', 'x')).toBeNull()
    expect(await rw(url('lib', 'a.js'), 'x')).toBeNull()
    expect(loads).toBe(0)
    expect(await rw(url('src', 'a.js'), 'x')).toBe('x|src/a.js')
    expect(await rw(url('src', 'b.js'), '')).toBeNull()
    expect(loads).toBe(1)
  })
  it('importRewrite charge rewriteExports depuis son fichier', async () => {
    const f = await H.importRewrite(fakeRewrite())
    expect(f('export {}', '/f', 'src/a.js')).toEqual({ code: 'export {}//src/a.js' })
  })
})

describe('crochet load', () => {
  const next = (r: { format?: string | null; source?: unknown }) => () => Promise.resolve(r)
  it('avant initialize : résultat d’origine', async () => {
    const r = { format: 'module', source: 'export const a = 1' }
    expect(await H.load(url('src', 'a.js'), {}, next(r))).toBe(r)
  })
  it('après initialize : modules ESM ciblés réécrits (chaîne ou octets) ; autres formats intacts', async () => {
    H.initialize({ ...cfg, rewritePath: fakeRewrite() })
    const target = url('src', 'a.js')
    expect(await H.load(target, {}, next({ format: 'module', source: 'export {}' }))).toEqual({
      format: 'module',
      source: 'export {}//src/a.js',
    })
    expect(
      await H.load(
        target,
        {},
        next({ format: 'module', source: new TextEncoder().encode('export {}') }),
      ),
    ).toEqual({ format: 'module', source: 'export {}//src/a.js' })
    for (const r of [
      { format: 'commonjs', source: 'module.exports = 1' },
      { format: 'module', source: null },
      { format: 'module' },
      { format: 'module', source: 'const a = 1' },
    ])
      expect(await H.load(target, {}, next(r))).toBe(r)
    const other = { format: 'module', source: 'export {}' }
    expect(await H.load(url('lib', 'a.js'), {}, next(other))).toBe(other)
  })
})
