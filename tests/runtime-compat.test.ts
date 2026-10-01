// Le code chargé DANS le runner (sonde, transform, superviseur) doit rester compatible avec les
// anciennes versions de Jest : pas de `require('node:…')` (voir docs/notes/sonde-jest.md).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RUNTIME_DIRS = [
  'packages/probe-runtime/runtime',
  'packages/adapters/jest/runtime',
  'packages/core/runtime',
]

describe('compatibilité du code de runtime', () => {
  for (const dir of RUNTIME_DIRS) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.cjs'))) {
      it(`${dir}/${f} : aucun require('node:…')`, () => {
        expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(/require\(['"]node:/)
      })
      it(`${dir}/${f} : aucun global récent absent des anciens environnements Jest`, () => {
        const src = readFileSync(join(dir, f), 'utf8')
        for (const g of [
          'performance',
          'structuredClone',
          'fetch',
          'TextEncoder',
          'AbortController',
        ]) {
          // Code sans commentaires ni lignes d'import : un global récent ne doit pas y apparaître.
          const code = src.replace(/\/\/.*$/gm, '').replace(/^.*= require\(.*$/gm, '')
          expect(
            new RegExp(`(?<![.\\w])${g}\\b(?!\\s*:)`).test(code),
            `${g} utilisé sans import`,
          ).toBe(false)
        }
      })
    }
  }
})
