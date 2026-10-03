// A-14 (D-027) : un test dont les empreintes d'arguments diffèrent entre les exécutions de baseline
// est FLAKY (NON_DETERMINISTIC_INPUT), exclu de la mutation et listé dans « non couvert ».
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeAdapter, fuzzRun, observeRun, type FakeTest } from '../../engine/test/fake.js'
import { runCli, type Io } from '../src/index.js'

/** Adapter scripté : le test `instable` reçoit un argument différent à chaque observation. */
function adapter() {
  let observations = 0
  const fuzzed: string[] = []
  const a = new FakeAdapter((o) => {
    if (o.mode !== 'observe') {
      const r = fuzzRun(o)
      fuzzed.push(r.tests?.[0]?.name ?? '')
      return r
    }
    observations++
    const tests: FakeTest[] = [
      { name: 'stable', calls: [{ export: 'f', args: ['Ada'] }] },
      { name: 'instable', calls: [{ export: 'g', args: [`now-${String(observations)}`] }] },
    ]
    return observeRun(tests)
  })
  return { a, fuzzed, observations: () => observations }
}

describe('tests non déterministes (A-14, D-027)', () => {
  it('FLAKY, exclu de la mutation, listé dans le rapport JSON et la ligne « Non couvert »', async () => {
    const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'varia-flaky-')))
    writeFileSync(
      join(d, 'varia.yml'),
      "version: 1\nmutations: { seed: 1, per_input: 1, strategies: ['null'] }\n",
    )
    const { a, fuzzed, observations } = adapter()
    const out: string[] = []
    const io: Io = { out: (l) => out.push(l), err: (l) => out.push(l) }
    const cli = (argv: string[]) =>
      runCli(['--data-dir', join(d, '.data'), ...argv], io, {
        env: { LANG: 'fr_FR.UTF-8' },
        cwd: d,
        adapter: () => a,
      })
    expect(await cli(['test'])).toBe(0)
    expect(observations()).toBeGreaterThanOrEqual(2)
    // Exclu de la mutation : seules les mutations du test stable ont été exécutées.
    expect(fuzzed.length).toBeGreaterThan(0)
    expect(new Set(fuzzed)).toEqual(new Set(['stable']))
    const text = out.join('\n')
    expect(text).toContain('Test instable (exclu du fuzz) : instable [NON_DETERMINISTIC_INPUT]')
    expect(text).toMatch(/^Non couvert : .* · 1 tests instables$/m)
    // Rapport JSON (validé par le schéma des rapports) du dernier run.
    expect(await cli(['report', '--out', 'r.json'])).toBe(0)
    const report = JSON.parse(readFileSync(join(d, 'r.json'), 'utf8')) as {
      notCovered: { flakyTests: string[] }
    }
    expect(report.notCovered.flakyTests).toEqual(['instable'])
  })
})
