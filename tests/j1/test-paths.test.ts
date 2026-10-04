// Intégration Orqea : `test.paths` restreint le périmètre des tests d'un gros projet (746 fichiers pour le
// frontend d'Orqea). Sans lui, Varia lançait TOUS les tests du projet à la baseline.
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deterministicConfig, json, newDataDir, varia } from './helpers.js'

interface Report {
  baseline: { tests: number }
}

async function baselineTests(extra: string[]): Promise<number> {
  const D = newDataDir()
  const cfg = deterministicConfig(extra)
  expect((await varia(['--data-dir', D, '--config', cfg, '-q', 'baseline'])).code).toBe(0)
  return json<Report>(await varia(['--data-dir', D, '--config', cfg, 'report'])).baseline.tests
}

describe('test.paths : périmètre des tests', () => {
  it('la baseline n’exécute que les tests ciblés, pas tout le projet', async () => {
    const all = await baselineTests([])
    const onlyUsers = await baselineTests(['test: { framework: jest, paths: [tests/users] }'])
    expect(onlyUsers).toBeGreaterThan(0)
    expect(onlyUsers).toBeLessThan(all)
  })

  it('Vitest : le motif est un filtre — un motif qui ne correspond à aucun test fait échouer la baseline', async () => {
    const root = resolve('examples/vitest-project')
    const run = async (pattern: string) => {
      const D = newDataDir()
      const cfg = deterministicConfig([`test: { framework: vitest, paths: [${pattern}] }`])
      return (await varia(['--data-dir', D, '--config', cfg, '-q', 'baseline'], root)).code
    }
    expect(await run('tests/users')).toBe(0)
    expect(await run('aucun-test-ne-porte-ce-nom')).not.toBe(0)
  })
})
