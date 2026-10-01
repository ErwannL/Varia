import { openReader, Reader } from '@varia/database'
import { SEED_RUN, SEED_RUN_2, seedDatabase } from '@varia/testkit'
import { describe, expect, it } from 'vitest'
import {
  buildReport,
  esc,
  toHtml,
  toJUnit,
  toMarkdown,
  toSarif,
  type Report,
} from '../src/index.js'

const report = (run = SEED_RUN): Report => {
  const o = openReader(seedDatabase(undefined, { second: true }).dbPath)
  const r = buildReport(new Reader(o.db), run)
  o.close()
  return r
}

describe('cas limites des formats', () => {
  it('HTML sans issue ni listes', () => {
    const r = {
      ...report(),
      issues: [],
      notCovered: {
        ...report().notCovered,
        neverCalled: [],
        transitiveOnly: [],
        unsupported: [],
        flakyTests: [],
      },
    }
    const html = toHtml(r, 'fr', 'https://o')
    expect(html).toContain('Aucune issue.')
    expect(html).toContain('(0)</h3>')
  })
  it('JUnit : mutation en attente ignorée, statut suspect', () => {
    const xml = toJUnit(report(), ['SUSPICIOUS_ACCEPT'])
    expect(xml).toContain('<skipped message="PENDING"/>')
    expect(xml).toContain('<failure type="SUSPICIOUS_ACCEPT"')
  })
  it('SARIF : issue sans cadre ⇒ aucune localisation ; Markdown en anglais', () => {
    const sarif = JSON.parse(toSarif(report())) as {
      runs: { results: { locations: unknown[] }[] }[]
    }
    expect(sarif.runs[0]?.results.some((x) => x.locations.length === 0)).toBe(true)
    expect(toMarkdown(report(), 'en')).toContain(
      '| Severity | State | Issue | Mutations | Replay |',
    )
  })
  it('second run : issue résolue FIXED, couverture collectée, comparaison', () => {
    const r = report(SEED_RUN_2)
    expect(r.resolvedIssues.map((i) => i.state)).toEqual(['FIXED'])
    expect(r.comparedTo).toBe(SEED_RUN)
    expect(r.baselineCoverage).toMatchObject({
      status: 'COLLECTED',
      files: [{ file: 'src/users.js', branches: 75 }],
    })
    expect(r.issues.every((i) => i.state === 'UNCHANGED')).toBe(true)
  })
  it('esc laisse le texte sûr intact', () => expect(esc('abc 123')).toBe('abc 123'))
})
