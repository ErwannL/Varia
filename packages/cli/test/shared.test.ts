// Outils communs du CLI : entrée d'acceptation, choix d'adapter, mode, ciblage, progression.
import { EngineContext } from '@varia/engine'
import { Command } from 'commander'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeAdapter } from '../../engine/test/fake.js'
import { printer } from '../src/io.js'
import {
  acceptanceYaml,
  adapterFor,
  filtersOf,
  fuzzWithSummary,
  modeOf,
  modeOptions,
  progress,
  targetingOptions,
} from '../src/shared.js'

const dir = (files: Record<string, string> = {}) => {
  const d = mkdtempSync(join(tmpdir(), 'varia-shared-'))
  for (const [f, c] of Object.entries(files)) writeFileSync(join(d, f), c)
  return d
}

describe('acceptanceYaml', () => {
  it('motif complet et motif minimal', () => {
    const full = { function: 'f', path: 'arg0', strategy: 'boundary', reason: 'r' }
    expect(acceptanceYaml({ ...full, owner: 'o', expires: '2027-01-01' })).toBe(
      '- {"mutation_pattern":{"function":"f","path":"arg0","strategy":"boundary"},"reason":"r","owner":"o","expires":"2027-01-01"}',
    )
    expect(
      acceptanceYaml({ ...full, path: null, strategy: null, owner: null, expires: null }),
    ).toBe('- {"mutation_pattern":{"function":"f"},"reason":"r"}')
  })
})

describe('adapterFor', () => {
  it('configuration illisible ou sans package.json : Jest par défaut', () => {
    expect(adapterFor(dir({ 'varia.yml': 'version: 9\n' })).id).toBe('jest')
    expect(adapterFor(dir()).id).toBe('jest')
  })
  it('dépendances : vitest seul ⇒ vitest ; framework explicite prioritaire', () => {
    expect(adapterFor(dir({ 'package.json': '{"devDependencies":{"vitest":"3"}}' })).id).toBe(
      'vitest',
    )
    expect(
      adapterFor(
        dir({
          'package.json': '{"dependencies":{"vitest":"3"}}',
          'varia.yml': 'version: 1\ntest: { framework: jest }\n',
        }),
      ).id,
    ).toBe('jest')
  })
  it('pytest (R-02) : `test.framework: pytest`', () => {
    expect(adapterFor(dir({ 'varia.yml': 'version: 1\ntest: { framework: pytest }\n' })).id).toBe(
      'pytest',
    )
  })
  it('phpunit : `test.framework: phpunit`', () => {
    expect(adapterFor(dir({ 'varia.yml': 'version: 1\ntest: { framework: phpunit }\n' })).id).toBe(
      'phpunit',
    )
  })
  it('junit : `test.framework: junit`', () => {
    expect(adapterFor(dir({ 'varia.yml': 'version: 1\ntest: { framework: junit }\n' })).id).toBe(
      'junit',
    )
  })
  it('custom (X-01) : `test.framework: custom` construit l’adaptateur depuis varia.yml', () => {
    const yml = "version: 1\ntest: { framework: custom, custom: { command: ['node', 'r.cjs'] } }\n"
    expect(adapterFor(dir({ 'varia.yml': yml })).id).toBe('custom')
  })
  it('Mocha (R-01) : `test.framework: mocha`, ou mocha seul dans les dépendances', () => {
    expect(adapterFor(dir({ 'varia.yml': 'version: 1\ntest: { framework: mocha }\n' })).id).toBe(
      'mocha',
    )
    expect(adapterFor(dir({ 'package.json': '{"devDependencies":{"mocha":"11"}}' })).id).toBe(
      'mocha',
    )
    // Mocha à côté de Jest ou de Vitest : le lanceur historique reste prioritaire.
    expect(
      adapterFor(dir({ 'package.json': '{"devDependencies":{"mocha":"11","jest":"29"}}' })).id,
    ).toBe('jest')
    expect(
      adapterFor(dir({ 'package.json': '{"devDependencies":{"mocha":"11","vitest":"3"}}' })).id,
    ).toBe('vitest')
  })
})

describe('mode et ciblage', () => {
  it('modeOf', () => {
    expect([modeOf({ quick: true }), modeOf({ full: true }), modeOf({})]).toEqual([
      'quick',
      'full',
      undefined,
    ])
  })
  it('options répétables ⇒ filtres de planification ; aucune ⇒ undefined', () => {
    const cmd = targetingOptions(modeOptions(new Command('x').exitOverride()))
    cmd.parse(
      ['--test', 'a', '--test', 'b', '--file', 'f', '--function', 'g', '--strategy', 's', '--full'],
      { from: 'user' },
    )
    expect(filtersOf(cmd.opts())).toEqual({
      tests: ['a', 'b'],
      files: ['f'],
      functions: ['g'],
      strategies: ['s'],
    })
    expect(modeOf(cmd.opts())).toBe('full')
    expect(filtersOf({})).toBeUndefined()
  })
})

describe('progress', () => {
  it('avertissements traduits : configuration, --keep-tmp, code connu', () => {
    const err: string[] = []
    const p = printer({ out: () => undefined, err: (l) => err.push(l) }, 'fr', false, false)
    const on = progress(() => p)
    on({ type: 'warning', message: 'CONFIG:UNKNOWN_KEY:a.b' })
    on({ type: 'warning', message: 'TMP_KEPT:/tmp/x:y' })
    on({ type: 'warning', message: 'INCREMENTAL_UNKNOWN_FULL' })
    on({ type: 'phase', phase: 'plan' })
    expect(err[0]).toMatch(/^Configuration : /)
    expect(err.slice(1)).toEqual([
      'Fichiers temporaires conservés (--keep-tmp) : /tmp/x:y',
      '--changed : portée indéterminable (git indisponible), repli sur le périmètre complet',
    ])
  })
})

describe('fuzzWithSummary', () => {
  it('autre erreur que PROJECT_MUTATED : propagée sans résumé', async () => {
    const d = dir({ 'varia.yml': 'version: 1\n' })
    const ctx = new EngineContext({
      root: d,
      adapter: new FakeAdapter(() => Promise.reject(new Error('non utilisé'))),
      dataDir: join(d, '.data'),
    })
    const out: string[] = []
    const p = printer({ out: (l) => out.push(l), err: () => undefined }, 'fr', false, false)
    await expect(fuzzWithSummary(p, ctx, 'r_absent', {})).rejects.toMatchObject({
      kind: 'PROJECT_FAILURE',
    })
    expect(out).toEqual([])
    ctx.close()
  })
})
