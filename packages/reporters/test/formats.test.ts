import { openReader, Reader } from '@varia/database'
import { SEED_RUN, seedDatabase } from '@varia/testkit'
import { describe, expect, it } from 'vitest'
import {
  buildReport,
  ciVerdict,
  esc,
  githubAnnotations,
  toHtml,
  toJUnit,
  toMarkdown,
  toSarif,
  type Report,
} from '../src/index.js'

function report(): Report {
  const o = openReader(seedDatabase().dbPath)
  const r = buildReport(new Reader(o.db), SEED_RUN)
  o.close()
  return r
}

describe('HTML autonome (CDC §31, prompt §4.2)', () => {
  const html = toHtml(report(), 'fr', 'https://orqea.example')
  it('signature en en-tête et en pied', () => {
    expect(html).toContain('<span class="name">Varia</span><span class="by">par Orqea</span>')
    expect(html).toContain('<a href="https://orqea.example" target="_top">Propulsé par Orqea</a>')
    expect(html).toContain(
      '<a href="https://github.com/ErwannL" target="_blank" rel="noreferrer noopener">Développé par Erwann Laplante</a>',
    )
    expect(html.toLowerCase()).not.toContain('nouvel onglet')
  })
  it('autonome : aucune ressource externe chargée, logo inline accessible', () => {
    expect(html).not.toMatch(/<(script|link|img)\b/)
    expect(html).toContain('role="img"')
    expect(html).toContain('<title>Varia</title>')
  })
  it('anglais, titres traduits, échappement', () => {
    const en = toHtml(report(), 'en', 'https://orqea.example')
    expect(en).toContain('Powered by Orqea')
    expect(en).toContain('src/values.js#repeat: timeout')
    expect(esc('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
  })
})

describe('JUnit, SARIF, Markdown', () => {
  it('JUnit : une suite par target, échecs selon fail_on, ignorées', () => {
    const xml = toJUnit(report(), ['CRASH', 'TIMEOUT'])
    expect(xml).toContain(
      '<testsuite name="src/users.js#createUser" tests="4" failures="2" skipped="1">',
    )
    expect(xml).toContain('<failure type="TIMEOUT"')
    expect(xml.match(/<testcase/g)).toHaveLength(7)
  })
  it('SARIF 2.1.0 : règles, niveaux, localisation', () => {
    const sarif = JSON.parse(toSarif(report())) as {
      version: string
      runs: {
        tool: { driver: { rules: { id: string }[] } }
        results: { level: string; locations: unknown[] }[]
      }[]
    }
    expect(sarif.version).toBe('2.1.0')
    const run = sarif.runs[0]
    expect(run?.tool.driver.rules.map((r) => r.id)).toEqual([
      'varia/ERROR',
      'varia/SUSPICIOUS_ACCEPT',
      'varia/TIMEOUT',
    ])
    expect(run?.results.map((r) => r.level)).toEqual(['error', 'error', 'warning'])
    expect(run?.results[1]?.locations).toEqual([
      {
        physicalLocation: { artifactLocation: { uri: 'src/users.js' }, region: { startLine: 14 } },
      },
    ])
  })
  it('Markdown', () => {
    const md = toMarkdown(report(), 'en')
    expect(md).toContain(
      '| Critical | NEW | src/values.js#repeat: timeout | 1 | `varia replay m_timeout` |',
    )
    expect(md).toContain('Powered by Orqea · Developed by Erwann Laplante')
  })
})

describe('politique CI (CDC §28)', () => {
  const r = report()
  it('fail_on', () => {
    expect(
      ciVerdict(r, { failOn: ['CRASH', 'TIMEOUT'], failOnRegression: false, reference: null }),
    ).toMatchObject({ fail: true })
    expect(ciVerdict(r, { failOn: [], failOnRegression: false, reference: null })).toEqual({
      fail: false,
      reasons: [],
    })
  })
  it('nouvelles issues seulement', () => {
    const all = new Set(r.issues.map((i) => i.id))
    expect(
      ciVerdict(r, {
        failOn: ['CRASH', 'TIMEOUT', 'SUSPICIOUS_ACCEPT'],
        failOnRegression: true,
        reference: all,
      }).fail,
    ).toBe(false)
  })
  it('régressions', () => {
    const reg = {
      ...r,
      issues: r.issues.map((i, n) => (n === 0 ? { ...i, state: 'REGRESSION' } : i)),
    }
    expect(ciVerdict(reg, { failOn: [], failOnRegression: true, reference: null }).reasons).toEqual(
      [`REGRESSION:${r.issues[0]?.id ?? ''}`],
    )
  })
  it('acceptées ignorées', () => {
    const acc = { ...r, issues: r.issues.map((i) => ({ ...i, state: 'ACCEPTED' })) }
    expect(
      ciVerdict(acc, { failOn: ['CRASH', 'TIMEOUT'], failOnRegression: true, reference: null })
        .fail,
    ).toBe(false)
  })
  it('annotations GitHub', () => {
    const lines = githubAnnotations(r)
    expect(lines[1]).toMatch(/^::error file=src\/users\.js,line=14 title=Varia ERROR::/)
    expect(lines[2]).toMatch(/^::warning title=Varia SUSPICIOUS_ACCEPT::/)
  })
})
