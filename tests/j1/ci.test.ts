// J2 : `varia ci` — sorties JUnit/SARIF/Markdown/HTML et mode « nouvelles issues seulement ».
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXAMPLE, newDataDir, varia } from './helpers.js'

describe('varia ci', () => {
  it('écrit les formats et échoue seulement sur les nouvelles issues', async () => {
    const D = newDataDir()
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: EXAMPLE,
      encoding: 'utf8',
    }).trim()
    const cfg = join(D, 'ci.yml')
    writeFileSync(
      cfg,
      readFileSync(join(EXAMPLE, 'varia.yml'), 'utf8') +
        `ci:\n  fail_on: [CRASH, TIMEOUT]\n  fail_on_new_only_against: ${branch}\n`,
    )
    const out = (f: string) => join(D, f)
    const args = [
      '--data-dir',
      D,
      '--config',
      cfg,
      'ci',
      '--quick',
      '--seed',
      '3',
      '--max-mutations',
      '25',
    ]
    const first = await varia([
      ...args,
      '--junit',
      out('j.xml'),
      '--sarif',
      out('s.sarif'),
      '--markdown',
      out('r.md'),
      '--html',
      out('r.html'),
      '--json-out',
      out('r.json'),
    ])
    expect(first.code, first.err).toBe(1)
    expect(first.err).toContain(`Aucun run de référence sur la branche ${branch}`)
    expect(readFileSync(out('j.xml'), 'utf8')).toContain('<testsuites name="varia"')
    expect((JSON.parse(readFileSync(out('s.sarif'), 'utf8')) as { version: string }).version).toBe(
      '2.1.0',
    )
    expect(readFileSync(out('r.html'), 'utf8')).toContain('Propulsé par Orqea')
    expect(readFileSync(out('r.md'), 'utf8')).toContain('# Rapport Varia')
    const second = await varia(args)
    expect(second.code, second.out).toBe(0)
    expect(second.out).toContain('Politique CI : PASS')
  })
})
