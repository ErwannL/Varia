// A-12 (J0-11 renforcé) : avec --keep-tmp, les journaux de la sonde sont CONSERVÉS ; on cherche les
// valeurs sensibles brutes dans TOUS les fichiers produits (JSONL, plan, base, rapports) et sur
// stdout/stderr. Le test exige d'abord que les journaux existent et contiennent le champ masqué : il
// ne peut pas passer « à vide ». Seul `jest-cache/` (source transformée des tests du projet, qui
// contient les littéraux du projet lui-même) est exclu (D-007).
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { newDataDir, varia } from '../j1/helpers.js'

const SECRETS = [
  'hunter2-secret',
  'pw-ada-secret',
  'pw-grace-secret',
  'pw-linus-secret',
  'pw-each-secret',
]

const files = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    if (f === 'jest-cache') return []
    const p = join(d, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })

describe('aucune valeur sensible brute sur disque (A-12, J0-11)', () => {
  it('journaux conservés (--keep-tmp), plan, base, rapports, sorties : aucun secret brut', async () => {
    const D = newDataDir()
    const out = mkdtempSync(join(tmpdir(), 'varia-rapports-'))
    const r = await varia([
      '--data-dir',
      D,
      '--keep-tmp',
      'ci',
      '--quick',
      '--max-mutations',
      '12',
      '--function',
      'createUser',
      '--json-out',
      join(out, 'r.json'),
      '--junit',
      join(out, 'r.xml'),
      '--sarif',
      join(out, 'r.sarif'),
      '--markdown',
      join(out, 'r.md'),
      '--html',
      join(out, 'r.html'),
    ])
    expect([0, 1], r.err).toContain(r.code)
    expect(r.err).toContain('--keep-tmp')
    const all = [...files(D), ...files(out)]
    const jsonl = all.filter((f) => f.endsWith('.jsonl'))
    // Non vide : des journaux de sonde conservés, avec des appels createUser dont le mot de passe
    // est présent mais masqué.
    expect(jsonl.length).toBeGreaterThan(0)
    const logs = jsonl.map((f) => readFileSync(f, 'utf8')).join('\n')
    expect(logs).toContain('"export":"createUser"')
    expect(logs).toMatch(/"password":\{"\$redacted"/)
    expect(all.some((f) => f.endsWith('varia.db'))).toBe(true)
    expect(files(out)).toHaveLength(5)
    const leaks = [
      ...all.flatMap((f) => {
        const c = readFileSync(f).toString('latin1')
        return SECRETS.filter((s) => c.includes(s)).map((s) => `${s} dans ${f}`)
      }),
      ...SECRETS.filter((s) => r.out.includes(s) || r.err.includes(s)).map((s) => `${s} en sortie`),
    ]
    expect(leaks).toEqual([])
  })
})
