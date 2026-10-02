import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import provider, { runtimeEntries } from '../scripts/vitest-coverage-provider.mjs'

// Racine absolue de la plateforme (`/r`, ou `D:\r` sous Windows) : URL et chemins natifs cohérents.
const R = resolve('/r')
const abs = (rel: string) => join(R, rel)
const u = (rel: string) => pathToFileURL(abs(rel)).href

const e = (url: string, startOffset?: number) =>
  startOffset === undefined ? { url, functions: [] } : { url, functions: [], startOffset }

describe('fournisseur de couverture de Varia', () => {
  it('garde la couverture brute des seuls fichiers d’exécution chargés nativement', () => {
    expect(
      runtimeEntries([
        e(u('packages/core/runtime/s.cjs'), 0),
        e(u('packages/adapters/vitest/runtime/p.mjs')),
        e(u('packages/core/src/a.ts'), 120),
        e(u('node_modules/x/packages/y/runtime/z.js')),
        e('node:fs'),
      ]).map((x: { url: string }) => x.url),
    ).toEqual([u('packages/core/runtime/s.cjs'), u('packages/adapters/vitest/runtime/p.mjs')])
  })
  it('refuse un fichier d’exécution chargé par Vite (positions décalées)', () => {
    expect(() => runtimeEntries([e(u('packages/core/runtime/s.cjs'), 42)])).toThrow(
      /chargé par Vite/,
    )
  })
  it('expose le fournisseur v8 de Vitest', () => {
    expect(typeof provider.getProvider).toBe('function')
    expect(typeof provider.startCoverage).toBe('function')
  })
})
