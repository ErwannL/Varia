// Tests EN PROCESSUS du transform Jest temporaire (stratégie D1, F-03).
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type TransformModule = typeof import('../runtime/transform.cjs')
const req = createRequire(import.meta.url)
const T = req('../runtime/transform.cjs') as TransformModule
const asyncHooks = req('node:async_hooks') as Record<symbol, unknown>

const root = '/p'
const cfg = (over: Partial<Parameters<TransformModule['createTransformer']>[0]> = {}) => ({
  original: null,
  originalConfig: { k: 1 },
  include: ['^src/'],
  exclude: ['^src/gen/'],
  projectRoot: root,
  salt: 'r_1',
  ...over,
})
const FOOTER = /__varia;if\(v&&typeof v\.wrapExports==="function"/

/** Transform d'origine factice écrit sur disque (comme ts-jest ou babel-jest). */
function original(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'varia-tr-'))
  const file = join(dir, 'orig.cjs')
  writeFileSync(file, body)
  return file
}

describe('transform Jest de Varia', () => {
  it('sans transform d’origine : pied de module ajouté aux seules cibles', () => {
    const t = T.createTransformer(cfg())
    expect(t.canInstrument).toBe(false)
    const out = t.process('module.exports = 1', '/p/src/a.js', {})
    expect(out.code).toMatch(/^module\.exports = 1\n;\(function\(m\)/)
    expect(out.code).toMatch(FOOTER)
    expect(out.code).toContain('"src/a.js"')
    for (const f of [
      '/p/src/gen/x.js',
      '/p/tests/a.test.js',
      '/p/node_modules/src/a.js',
      '/q/src/a.js',
    ])
      expect(t.process('x', f, {}).code).toBe('x')
  })
  it('délègue au transform d’origine (fabrique, défaut, chaîne, objet, async)', async () => {
    const factory = original(
      "module.exports = { createTransformer: (c) => ({ canInstrument: true, process: (s, f, o) => ({ code: s + '/*' + o.transformerConfig.k + c.k + '*/', map: 'm' }) }) }",
    )
    const t = T.createTransformer(cfg({ original: factory }))
    expect(t.canInstrument).toBe(true)
    const out = t.process('a', '/p/src/a.js', {})
    expect(out.code.startsWith('a/*11*/')).toBe(true)
    expect(out.map).toBe('m')
    const viaDefault = original(
      "module.exports = { default: { createTransformer: () => ({ process: () => 'B' }) } }",
    )
    expect(
      T.createTransformer(cfg({ original: viaDefault })).process('a', '/p/x.js', {}).code,
    ).toBe('B')
    const plainDefault = original('module.exports = { default: { process: () => undefined } }')
    expect(
      T.createTransformer(cfg({ original: plainDefault })).process('s', '/p/x.js', {}).code,
    ).toBe('s')
    const plain = original('module.exports = { processAsync: async (s) => s + "!" }')
    const tp = T.createTransformer(cfg({ original: plain }))
    expect((await tp.processAsync('s', '/p/x.js', {})).code).toBe('s!')
    expect(tp.process('s', '/p/x.js', {}).code).toBe('s')
    const syncOnly = original('module.exports = { process: (s) => s + "?" }')
    expect(
      (await T.createTransformer(cfg({ original: syncOnly })).processAsync('s', '/p/x.js', {}))
        .code,
    ).toBe('s?')
    expect((await T.createTransformer(cfg()).processAsync('s', '/p/src/a.js', {})).code).toMatch(
      FOOTER,
    )
  })
  it('clé de cache : sel du run, ciblage, clé d’origine', () => {
    const a = T.createTransformer(cfg()).getCacheKey('s', '/p/src/a.js', {})
    expect(T.createTransformer(cfg({ salt: 'r_2' })).getCacheKey('s', '/p/src/a.js', {})).not.toBe(
      a,
    )
    expect(
      T.createTransformer(cfg({ include: ['^lib/'] })).getCacheKey('s', '/p/src/a.js', {}),
    ).not.toBe(a)
    const keyed = original('module.exports = { process: (s) => s, getCacheKey: () => "K" }')
    const k1 = T.createTransformer(cfg({ original: keyed })).getCacheKey('s', '/p/src/a.js', {})
    const k2 = T.createTransformer(cfg({ original: keyed })).getCacheKey('autre', '/p/src/b.js', {})
    expect(k1).toBe(k2)
  })
  it('publie le processus réel pour la sonde (A-02), sur le module async_hooks partagé', () => {
    expect(asyncHooks[Symbol.for('varia.process')]).toBe(process)
    const holder: Record<symbol, unknown> = {}
    T.publishProcess(holder, process)
    expect(holder[Symbol.for('varia.process')]).toBe(process)
  })
})
