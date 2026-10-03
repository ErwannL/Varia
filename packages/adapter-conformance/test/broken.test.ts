// La suite ÉCHOUE contre un adapter défaillant : un vrai adapter Jest enveloppé, un comportement cassé.
import {
  conformanceFiles,
  runConformance,
  systemProcesses,
  type CheckId,
  type ConformanceReport,
} from '@varia/adapter-conformance'
import type { PrepareContext, TestAdapter } from '@varia/core'
import { JestAdapter } from '@varia/adapter-jest'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const EXAMPLE = resolve('examples/jest-project')
const DIALECT = { module: 'cjs', ext: 'js' } as const

/** Enveloppe un vrai adapter Jest ; `patch` remplace une partie de son comportement. */
function broken(patch: (real: JestAdapter) => Partial<TestAdapter>): TestAdapter {
  const real = new JestAdapter()
  return {
    id: 'broken',
    detect: (root) => real.detect(root),
    capabilities: () => real.capabilities(),
    prepare: (ctx) => real.prepare(ctx),
    run: (o) => real.run(o),
    ...patch(real),
  }
}

const failing = (r: ConformanceReport) =>
  r.checks.filter((c) => c.status !== 'PASS').map((c) => [c.id, c.status])
const run = (adapter: TestAdapter, listProcesses?: () => string[] | null) =>
  runConformance({
    adapter,
    example: EXAMPLE,
    dialect: DIALECT,
    timeoutMs: 60_000,
    ...(listProcesses !== undefined ? { listProcesses } : {}),
  })

describe('adapter défaillant', () => {
  it('filtre de test ignoré : la sélection échoue, et elle seule', async () => {
    const r = await run(
      broken((real) => ({
        run: (o) => {
          const unfiltered = { ...o }
          delete unfiltered.testFile
          delete unfiltered.testName
          return real.run(unfiltered)
        },
      })),
    )
    expect(r.passed).toBe(false)
    expect(failing(r)).toEqual([['selection', 'FAIL']])
  })

  it('mutation jamais appliquée : la vérification de mutation échoue, et elle seule', async () => {
    const r = await run(broken((real) => ({ run: (o) => real.run({ ...o, mode: 'observe' }) })))
    expect(r.passed).toBe(false)
    expect(failing(r)).toEqual([['mutation', 'FAIL']])
    expect(r.checks.find((c) => c.id === 'mutation')?.detail).toContain('SKIPPED')
  })

  it('fichier laissé dans le projet et processus survivant : le nettoyage échoue', async () => {
    const ids: string[] = []
    let root = ''
    const r = await run(
      broken((real) => ({
        prepare: (ctx: PrepareContext) => {
          ids.push(ctx.runId)
          root = ctx.root
          return real.prepare(ctx)
        },
        run: async (o) => {
          const out = await real.run(o)
          writeFileSync(join(root, 'reste.txt'), 'oubli')
          return out
        },
      })),
      () => ids.map((id) => `node jest --varia ${id}`),
    )
    const cleanup = r.checks.find((c) => c.id === 'cleanup')
    expect(cleanup?.status).toBe('FAIL')
    expect(cleanup?.detail).toContain('reste.txt')
    expect(cleanup?.detail).toContain(`node jest --varia ${ids[0] ?? '?'}`)
  })

  it('panne totale : chaque vérification échoue ; processus non listables ⇒ UNVERIFIED', async () => {
    const r = await run(
      broken(() => ({
        detect: () =>
          Promise.resolve({
            detected: false,
            framework: 'none',
            version: null,
            nativeEsm: false,
            reasons: ['absent'],
          }),
        prepare: () => Promise.reject(new Error('préparation impossible')),
      })),
      () => null,
    )
    const expected: [CheckId, string][] = [
      ['baseline', 'FAIL'],
      ['observation', 'FAIL'],
      ['async', 'FAIL'],
      ['multipleCalls', 'FAIL'],
      ['exception', 'FAIL'],
      ['parameterized', 'FAIL'],
      ['selection', 'FAIL'],
      ['mutation', 'FAIL'],
      ['cleanup', 'UNVERIFIED'],
    ]
    expect(failing(r)).toEqual(expected)
    expect(r.checks.find((c) => c.id === 'observation')?.detail).toContain('préparation impossible')
  })
})

describe('outils', () => {
  it('processus du système : listés sous POSIX, non listables sous Windows', () => {
    expect(systemProcesses('win32')).toBeNull()
    expect(systemProcesses('linux')?.some((l) => l.includes('node'))).toBe(true)
  })
  it('fichiers de conformité : dialectes CommonJS et ESM', () => {
    const cjs = conformanceFiles(DIALECT)
    expect(cjs['src/conformance.js']).toContain('module.exports = {')
    expect(cjs['tests/conformance.test.js']).toContain("require('../src/conformance')")
    const esm = conformanceFiles({
      module: 'esm',
      ext: 'ts',
      testImport: "import { test } from 'x'",
    })
    expect(esm['src/conformance.ts']).toContain('export { ConformanceError')
    expect(esm['tests/conformance.test.ts']?.startsWith("import { test } from 'x'\nimport {")).toBe(
      true,
    )
  })
})
