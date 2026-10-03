// Sonde PHP (R-03) : ses tests PHPUnit (rejeu du jeu de conformité du protocole compris) lancés par
// l'interpréteur PHP, avec la couverture pcov ; le test échoue sous 100 % des lignes de runtime/src.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const RUNTIME = resolve('packages/adapters/phpunit/runtime')
const VENDOR = resolve('examples/phpunit-project/vendor')

/** Lignes (instructions) couvertes / totales par fichier, lues dans un rapport Clover. */
export function cloverLines(xml: string): Record<string, { covered: number; total: number }> {
  const out: Record<string, { covered: number; total: number }> = {}
  for (const m of xml.matchAll(/<file name="([^"]+)">([\s\S]*?)<\/file>/g)) {
    const lines = [...(m[2] ?? '').matchAll(/<line num="\d+" type="stmt" count="(\d+)"/g)]
    // Clover rapporte des chemins natifs (`\` sous Windows) : clés en séparateurs POSIX.
    out[
      (m[1] ?? '')
        .slice(RUNTIME.length + 1)
        .split('\\')
        .join('/')
    ] = {
      covered: lines.filter((l) => l[1] !== '0').length,
      total: lines.length,
    }
  }
  return out
}

describe('sonde PHP : tests PHPUnit et couverture pcov', () => {
  it('lecture du rapport Clover (contre-épreuve : une ligne non couverte est comptée)', () => {
    const xml = `<file name="${RUNTIME}/src/A.php"><line num="1" type="stmt" count="2"/><line num="2" type="stmt" count="0"/><line num="3" type="method" count="0"/></file>`
    expect(cloverLines(xml)).toEqual({ 'src/A.php': { covered: 1, total: 2 } })
    const win = `<file name="${RUNTIME}\\src\\B.php"><line num="1" type="stmt" count="1"/></file>`
    expect(cloverLines(win)).toEqual({ 'src/B.php': { covered: 1, total: 1 } })
  })

  it('tous les tests passent et chaque fichier de runtime/src est couvert à 100 % (lignes)', () => {
    expect(execFileSync('php', ['-m'], { encoding: 'utf8' })).toMatch(/^pcov$/m)
    const clover = join(mkdtempSync(join(tmpdir(), 'varia-php-cov-')), 'clover.xml')
    const r = spawnSync(
      'php',
      [
        '-d',
        'pcov.enabled=1',
        '-d',
        `pcov.directory=${join(RUNTIME, 'src')}`,
        join(VENDOR, 'bin', 'phpunit'),
        '-c',
        join(RUNTIME, 'phpunit.xml'),
        '--coverage-clover',
        clover,
      ],
      { encoding: 'utf8', env: { ...process.env, VARIA_PHPUNIT_VENDOR: VENDOR } },
    )
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout).toMatch(/OK \(\d+ tests/)
    const cov = cloverLines(readFileSync(clover, 'utf8'))
    expect(Object.keys(cov).sort()).toEqual(
      [
        'Absent',
        'Boot',
        'Extension',
        'Json',
        'Loader',
        'Mutation',
        'Probe',
        'Rewriter',
        'Serializer',
      ].map((f) => `src/${f}.php`),
    )
    const missing = Object.entries(cov).filter(([, c]) => c.covered !== c.total || c.total === 0)
    expect(missing).toEqual([])
  }, 120_000)
})
