// Sonde Python (R-02) : sa propre suite (pytest), dont le REJEU de toutes les fixtures de
// packages/probe-protocol/conformance/, mesurée par coverage.py. Échoue si un test Python échoue ou si
// la couverture des lignes OU des branches de runtime/varia_probe/ est inférieure à 100 %.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PY_RUNTIME_DIR, resolvePython } from '../src/adapter.js'

// Interpréteur de l'exemple (pytest et coverage installés par `npm run examples:install`).
const PYTHON = resolvePython(resolve('examples/pytest-project'))
const TESTS = resolve('packages/adapters/pytest/test/python')

interface CoverageJson {
  files: Record<
    string,
    {
      summary: {
        num_statements: number
        covered_lines: number
        num_branches: number
        covered_branches: number
      }
    }
  >
}

describe('sonde Python : suite pytest, conformité, couverture coverage.py', () => {
  it('toutes les fixtures rejouées, 100 % des lignes et des branches de varia_probe', () => {
    const work = mkdtempSync(join(tmpdir(), 'varia-pycov-'))
    const env = {
      ...process.env,
      PYTHONPATH: PY_RUNTIME_DIR,
      PYTHONDONTWRITEBYTECODE: '1',
      COVERAGE_FILE: join(work, 'coverage'),
    }
    const py = (args: string[]) =>
      execFileSync(PYTHON, args, { cwd: TESTS, env, encoding: 'utf8', stdio: 'pipe' })
    const out = py([
      '-m',
      'coverage',
      'run',
      '--branch',
      '--source=varia_probe',
      '-m',
      'pytest',
      '-p',
      'no:cacheprovider',
      '-q',
      '--basetemp',
      join(work, 'pytest'),
    ])
    // Un cas de conformité non rejouable est xfail, jamais compté réussi.
    expect(out).toMatch(/\d+ passed, 1 xfailed/)
    py(['-m', 'coverage', 'json', '-o', join(work, 'coverage.json')])
    const files = (JSON.parse(readFileSync(join(work, 'coverage.json'), 'utf8')) as CoverageJson)
      .files
    const rows = Object.entries(files).map(([f, { summary: s }]) => [
      // coverage.py écrit des chemins natifs (`varia_probe\\probe.py` sous Windows) : POSIX ici.
      f.slice(f.indexOf('varia_probe')).replaceAll('\\', '/'),
      `${String(s.covered_lines)}/${String(s.num_statements)}`,
      `${String(s.covered_branches)}/${String(s.num_branches)}`,
    ])
    expect(rows.map((r) => r[0]).sort()).toEqual([
      'varia_probe/__init__.py',
      'varia_probe/plugin.py',
      'varia_probe/probe.py',
      'varia_probe/serialize.py',
    ])
    // Toute ligne ou branche non couverte apparaît ici (fichier, lignes, branches).
    const gaps = rows.filter(([, l, b]) => {
      const [cl, nl] = (l as string).split('/')
      const [cb, nb] = (b as string).split('/')
      return cl !== nl || cb !== nb
    })
    expect(gaps).toEqual([])
  })
})
