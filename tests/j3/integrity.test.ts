// B-01 de bout en bout : un test qui écrit dans le projet pendant une mutation ⇒ PROJECT_MUTATED (exit 4),
// résumé imprimé, fichiers listés, run marqué et jamais pris comme référence.
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { newDataDir, varia, withReader } from '../j1/helpers.js'

const LIMITS = resolve('examples/limits-project')

function leakyProject(): string {
  const d = mkdtempSync(join(tmpdir(), 'varia-leak-'))
  cpSync(join(LIMITS, 'package.json'), join(d, 'package.json'))
  symlinkSync(join(LIMITS, 'node_modules'), join(d, 'node_modules'), 'dir')
  mkdirSync(join(d, 'src'))
  mkdirSync(join(d, 'tests'))
  writeFileSync(join(d, 'src', 'id.js'), 'module.exports = { id: (x) => x }\n')
  writeFileSync(
    join(d, 'tests', 'id.test.js'),
    [
      "const fs = require('fs')",
      "const path = require('path')",
      "const { id } = require('../src/id')",
      "test('id', () => {",
      // Effet de bord PENDANT le fuzz seulement : la baseline est propre, la mutation salit le projet.
      "  if (process.env.VARIA_MODE === 'fuzz') fs.writeFileSync(path.join(__dirname, '..', 'leak.txt'), 'x')",
      '  expect(id(1)).toBe(1)',
      '})',
    ].join('\n'),
  )
  return d
}

describe('projet modifié pendant le fuzz (B-01)', () => {
  it('exit 4, résumé et fichiers imprimés, run marqué PROJECT_MUTATED', async () => {
    const d = leakyProject()
    const D = newDataDir()
    const cfg = join(mkdtempSync(join(tmpdir(), 'varia-cfg-')), 'varia.yml')
    writeFileSync(cfg, "version: 1\nmutations: { seed: 1, per_input: 1, strategies: ['null'] }\n")
    const r = await varia(['--data-dir', D, '--config', cfg, 'test'], d)
    expect(r.code).toBe(4)
    expect(r.err).toContain('PROJECT_MUTATED')
    expect(r.err).toContain('leak.txt')
    // Le résumé du run est imprimé avant l'erreur.
    expect(r.out + r.err).toMatch(/mutations/)
    withReader(D, (rd) => {
      const run = rd.listRuns(1)[0]
      expect(run?.state).toBe('PROJECT_MUTATED')
      expect(run?.info['projectMutated']).toEqual(['leak.txt'])
    })
  })
})
