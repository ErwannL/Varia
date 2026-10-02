import { describe, expect, it } from 'vitest'
import provider, { runtimeEntries } from '../scripts/vitest-coverage-provider.mjs'

const e = (url: string, startOffset?: number) =>
  startOffset === undefined ? { url, functions: [] } : { url, functions: [], startOffset }

describe('fournisseur de couverture de Varia', () => {
  it('garde la couverture brute des seuls fichiers d’exécution chargés nativement', () => {
    expect(
      runtimeEntries([
        e('file:///r/packages/core/runtime/s.cjs', 0),
        e('file:///r/packages/adapters/vitest/runtime/p.mjs'),
        e('file:///r/packages/core/src/a.ts', 120),
        e('file:///r/node_modules/x/packages/y/runtime/z.js'),
        e('node:fs'),
      ]).map((x: { url: string }) => x.url),
    ).toEqual([
      'file:///r/packages/core/runtime/s.cjs',
      'file:///r/packages/adapters/vitest/runtime/p.mjs',
    ])
  })
  it('refuse un fichier d’exécution chargé par Vite (positions décalées)', () => {
    expect(() => runtimeEntries([e('file:///r/packages/core/runtime/s.cjs', 42)])).toThrow(
      /chargé par Vite/,
    )
  })
  it('expose le fournisseur v8 de Vitest', () => {
    expect(typeof provider.getProvider).toBe('function')
    expect(typeof provider.startCoverage).toBe('function')
  })
})
