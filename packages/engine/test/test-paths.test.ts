import type { TestAdapter } from '@varia/core'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EngineContext, prepareContext, VariaError } from '../src/index.js'

const adapter = (id: string): TestAdapter => ({
  id,
  detect: async () => ({
    detected: true,
    framework: id,
    version: '1',
    nativeEsm: false,
    reasons: [],
  }),
  capabilities: () => ({
    observation: true,
    argumentMutation: true,
    perTestSelection: true,
    asyncTargets: true,
    esm: false,
    cjs: true,
    mocks: false,
    testParameters: true,
    coverage: false,
    isolatedProcess: true,
    parallelSafe: false,
  }),
  prepare: async () => undefined,
  run: async () => {
    throw new Error('non utilisé')
  },
})

const context = (id: string, yml: string) => {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'varia-paths-')))
  writeFileSync(join(d, 'varia.yml'), yml)
  const ctx = new EngineContext({ root: d, adapter: adapter(id), dataDir: join(d, '.d') })
  ctx.close()
  return ctx
}

describe('prepareContext : test.paths', () => {
  it('jest et vitest : le périmètre est transmis à l’adapter', () => {
    for (const id of ['jest', 'vitest'])
      expect(
        prepareContext(context(id, 'version: 1\ntest: { paths: [src/utils] }\n'), 'r', '/t').paths,
      ).toEqual(['src/utils'])
  })
  it('lanceur DÉTECTÉ qui ne sait pas restreindre ses tests : refus explicite (exit 3), jamais ignoré', () => {
    const ctx = context('mocha', 'version: 1\ntest: { paths: [src/utils] }\n')
    let error: unknown
    try {
      prepareContext(ctx, 'r', '/t')
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(VariaError)
    expect((error as VariaError).kind).toBe('CONFIG_FAILURE')
    expect((error as VariaError).details[0]).toContain('UNSUPPORTED_TEST_PATHS')
    expect((error as VariaError).details[0]).toContain('mocha')
  })
  it('sans test.paths : n’importe quel lanceur passe', () => {
    expect(prepareContext(context('mocha', 'version: 1\n'), 'r', '/t').paths).toEqual([])
  })
})
