// A-04 : `targets.depth: all` mute aussi les appels transitifs ; leurs issues sont TRANSITIVE, hors
// `ci.fail_on` sauf `ci.include_transitive: true` (CDC §10.11).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { newDataDir, varia } from '../j1/helpers.js'

const config = (includeTransitive: boolean) => {
  const file = join(mkdtempSync(join(tmpdir(), 'varia-cfg-')), 'varia.yml')
  writeFileSync(
    file,
    [
      'version: 1',
      // Seule `inner` est ciblée : elle n'est appelée QUE par `outer` (profondeur 1).
      'targets: { mode: declared, declared: [inner], include: ["src/**"], depth: all }',
      "mutations: { mode: normal, seed: 5, per_input: 3, strategies: ['null', type] }",
      'execution: { timeout_ms: 3000 }',
      `ci: { fail_on: [CRASH, TIMEOUT], include_transitive: ${String(includeTransitive)} }`,
    ].join('\n'),
  )
  return file
}

interface Report {
  issues: { target: string; transitive: boolean; depth: number }[]
  mutations: { target: string; depth: number }[]
}

describe('appels transitifs mutés (targets.depth: all)', () => {
  it('issues TRANSITIVE : hors fail_on par défaut, comptées avec include_transitive', async () => {
    const D = newDataDir()
    const out = join(D, 'report.json')
    const off = await varia(['--data-dir', D, '--config', config(false), 'ci', '--json-out', out])
    expect(off.code, off.err).toBe(0)
    const report = JSON.parse(readFileSync(out, 'utf8')) as Report
    expect(report.mutations.length).toBeGreaterThan(0)
    expect(report.mutations.every((m) => m.target === 'src/text.js#inner' && m.depth === 1)).toBe(
      true,
    )
    expect(report.issues.length).toBeGreaterThan(0)
    expect(report.issues.every((i) => i.transitive && i.depth === 1)).toBe(true)
    const on = await varia(['--data-dir', newDataDir(), '--config', config(true), 'ci'])
    expect(on.code, on.err).toBe(1)
  })
})
