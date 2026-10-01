// J2 : couverture de baseline (CDC §23) — collectée hors du projet, jamais une preuve de robustesse.
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXAMPLE, json, newDataDir, varia } from './helpers.js'

interface R {
  baselineCoverage: { status: string; files: { file: string; lines: number; branches: number }[] }
}

describe('couverture de baseline', () => {
  it('Jest : collectée par fichier', async () => {
    const D = newDataDir()
    const cfg = join(D, 'c.yml')
    writeFileSync(
      cfg,
      readFileSync(join(EXAMPLE, 'varia.yml'), 'utf8') + 'coverage: { baseline: true }\n',
    )
    expect((await varia(['--data-dir', D, '--config', cfg, '-q', 'baseline'])).code).toBe(0)
    const r = json<R>(await varia(['--data-dir', D, '--config', cfg, 'report']))
    expect(r.baselineCoverage.status).toBe('COLLECTED')
    const users = r.baselineCoverage.files.find((f) => f.file === 'src/users.js')
    expect(users?.lines).toBeGreaterThan(50)
    expect(users?.branches).toBeLessThan(100)
  })
  it('Vitest avec fournisseur v8 résolvable : collectée', async () => {
    const D = newDataDir()
    const root = resolve('examples/vitest-project')
    const cfg = join(D, 'c.yml')
    writeFileSync(cfg, 'version: 1\ncoverage: { baseline: true }\n')
    expect((await varia(['--data-dir', D, '--config', cfg, '-q', 'baseline'], root)).code).toBe(0)
    const r = json<R>(await varia(['--data-dir', D, '--config', cfg, 'report'], root))
    expect(r.baselineCoverage.status).toBe('COLLECTED')
    expect(r.baselineCoverage.files.map((f) => f.file)).toContain('src/users.ts')
  })
  it('Vitest sans fournisseur de couverture : UNAVAILABLE, jamais inventée', async () => {
    const root = mkdtempSync(join(tmpdir(), 'varia-vcov-'))
    for (const f of ['src', 'tests', 'package.json', 'vitest.config.ts'])
      cpSync(join('examples/vitest-project', f), join(root, f), { recursive: true })
    symlinkSync(resolve('examples/vitest-project/node_modules'), join(root, 'node_modules'), 'dir')
    const D = newDataDir()
    const cfg = join(D, 'c.yml')
    writeFileSync(cfg, 'version: 1\ncoverage: { baseline: true }\n')
    expect((await varia(['--data-dir', D, '--config', cfg, '-q', 'baseline'], root)).code).toBe(0)
    const r = json<R>(await varia(['--data-dir', D, '--config', cfg, 'report'], root))
    expect(r.baselineCoverage).toEqual({ status: 'UNAVAILABLE', files: [] })
  })
  it('désactivée par défaut', async () => {
    const D = newDataDir()
    expect((await varia(['--data-dir', D, '-q', 'baseline'])).code).toBe(0)
    expect(json<R>(await varia(['--data-dir', D, 'report'])).baselineCoverage.status).toBe(
      'DISABLED',
    )
  })
})
