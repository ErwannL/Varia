// Sonde Java (R-04), lancée depuis vitest : `mvn verify` HORS LIGNE dans un dossier de construction
// temporaire. Le build rejoue TOUTES les fixtures de conformité (ConformanceTest) et échoue si la
// couverture JaCoCo de la sonde n'est pas de 100 % en lignes ET en branches (règle `check`).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const POM = resolve('packages/adapters/junit/agent/pom.xml')

describe('sonde Java : conformité 1.2 et couverture JaCoCo', () => {
  it('mvn verify : fixtures rejouées (60 réussies, 5 non rejouables listées), JaCoCo 100 % lignes et branches', async () => {
    const build = mkdtempSync(join(tmpdir(), 'varia-junit-agent-'))
    // Asynchrone : un `mvn verify` synchrone bloquerait le fil du worker vitest (délai RPC sous charge).
    const r = await new Promise<{ status: number | null; stdout: string }>((done, fail) => {
      const p = spawn('mvn', ['-o', '-B', '-f', POM, `-Dvaria.buildDir=${build}`, 'verify'], {
        shell: process.platform === 'win32',
      })
      let stdout = ''
      p.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
      p.on('error', fail)
      p.on('close', (status) => done({ status, stdout }))
    })
    expect(r.status, r.stdout.slice(-4000)).toBe(0)
    expect(r.stdout).toContain('[varia-conformance] passed=60 not-replayable=5')
    expect(r.stdout).toContain('All coverage checks have been met.')
    expect(existsSync(join(build, 'varia-junit-agent.jar'))).toBe(true)
    const csv = readFileSync(join(build, 'site', 'jacoco', 'jacoco.csv'), 'utf8')
      .trim()
      .split('\n')
    const rows = csv.slice(1).map((l) => l.split(','))
    // Colonnes : …, BRANCH_MISSED (5), BRANCH_COVERED (6), LINE_MISSED (7), LINE_COVERED (8).
    expect(rows.length).toBeGreaterThanOrEqual(10)
    expect(rows.filter((c) => c[5] !== '0' || c[7] !== '0')).toEqual([])
  }, 600_000)
})
