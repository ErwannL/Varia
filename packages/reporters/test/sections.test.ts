// @vitest-environment jsdom
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// B-09 (échappements JUnit / GitHub), E-01/E-05 (HTML : logo exact, sections, signature), E-02
// (Markdown), D-01 (capacités déclarées ET vérifiées dans le rapport).
import { openReader, Reader } from '@varia/database'
import { SEED_RUN, seedDatabase } from '@varia/testkit'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildReport,
  capabilitiesOf,
  limitationsOf,
  ghData,
  ghProperty,
  githubAnnotations,
  LOGO_SVG,
  toHtml,
  toJUnit,
  toMarkdown,
  xmlText,
  type Report,
} from '../src/index.js'

const ROOT = join(import.meta.dirname, '..', '..', '..')

function report(): Report {
  const o = openReader(seedDatabase().dbPath)
  const r = buildReport(new Reader(o.db), SEED_RUN)
  o.close()
  return r
}

/** Document HTML analysé par le navigateur simulé. */
const html2doc = (h: string) => new DOMParser().parseFromString(h, 'text/html')

/** Analyse XML stricte (saxes via jsdom) : document d'erreur si le XML est mal formé. */
const parseXml = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
  return doc
}
/** Caractères autorisés par XML 1.0 (§2.2). */
const XML10 = /^[\t\n\r -퟿-�\u{10000}-\u{10FFFF}]*$/u

const HOSTILE = 'a\u0000b\u0001\u0008\u000B\u000C\u001F￾\uD800 & <x> ]]> "q" \'s\'\r\nfin\t%'

describe('B-09 : JUnit relu par un analyseur XML strict', () => {
  const r = report()
  const hostile: Report = {
    ...r,
    mutations: r.mutations.map((m) => ({
      ...m,
      target: `${m.target}${HOSTILE}`,
      path: HOSTILE,
      reason: HOSTILE,
      status: m.status ?? 'SKIPPED',
      error: { name: `E${HOSTILE}`, message: HOSTILE },
    })),
  }
  it('caractères interdits retirés, valeurs restituées à l’identique par l’analyseur', () => {
    const xml = toJUnit(hostile, ['CRASH', 'TIMEOUT', 'SKIPPED'])
    expect(XML10.test(xml)).toBe(true)
    const doc = parseXml(xml)
    const failure = doc.getElementsByTagName('failure')[0]
    const clean = 'ab & <x> ]]> "q" \'s\'\r\nfin\t%'
    expect(failure?.getAttribute('message')).toBe(`E${clean}: ${clean}`)
    expect(doc.getElementsByTagName('testcase')[0]?.getAttribute('classname')).toContain(clean)
  })
  it('sans nettoyage, le même XML est rejeté (le contrôle est discriminant)', () => {
    const doc = new DOMParser().parseFromString(
      `<a b="${HOSTILE.replace(/&/g, '&amp;').replace(/</g, '&lt;')}"/>`,
      'application/xml',
    )
    expect(doc.getElementsByTagName('parsererror').length).toBeGreaterThan(0)
    expect(xmlText('\u0000ok😀\uDFFF')).toBe('ok😀')
  })
})

describe('B-09 : annotations GitHub, échappement exact', () => {
  it('message : %, CR, LF ; propriétés : en plus « : » et « , »', () => {
    expect(ghData('50%\r\na:b,c')).toBe('50%25%0D%0Aa:b,c')
    expect(ghProperty('50%\r\na:b,c')).toBe('50%25%0D%0Aa%3Ab%2Cc')
  })
  it('fichier et titre hostiles échappés, une seule ligne par annotation', () => {
    const r = report()
    const i = r.issues[0] as Report['issues'][number]
    const lines = githubAnnotations({
      ...r,
      issues: [{ ...i, kind: 'K:1,2', frame: 'at f (src/a,b%.js:7)', title: 'x\ny%' }],
    })
    expect(lines).toEqual([
      `::${i.severity === 'CRITICAL' || i.severity === 'HIGH' ? 'error' : 'warning'} file=src/a%2Cb%25.js,line=7,title=Varia K%3A1%2C2::x%0Ay%25 (${String(i.count)} mutations) — ${i.replay}`,
    ])
  })
})

describe('E-01 / E-05 : rapport HTML', () => {
  const r = report()
  const html = toHtml(r, 'fr', 'https://orqea.example')
  it('logo : copie exacte de brand/varia.svg (tracés, tuile), id de titre propre', () => {
    const brand = readFileSync(join(ROOT, 'brand', 'varia.svg'), 'utf8').trim()
    expect(LOGO_SVG).toBe(brand.replace(/varia-title/g, 'varia-report-logo-title'))
    const shapes = (s: string) => s.match(/<(path|rect)\b[^>]*>/g)
    expect(shapes(LOGO_SVG)).toEqual(shapes(brand))
    expect(shapes(LOGO_SVG)).toHaveLength(4)
    expect(html).toContain(LOGO_SVG)
    expect(html).not.toContain('M15 19 L30 47')
  })
  it('signature : byline en en-tête et en pied, poweredBy vers Orqea, auteur', () => {
    const doc = html2doc(html)
    expect(doc.querySelector('header .by')?.textContent).toBe('par Orqea')
    expect(doc.querySelector('footer .by')?.textContent).toBe('Varia par Orqea')
    const links = [...doc.querySelectorAll('footer a')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ])
    expect(links).toEqual([
      ['Propulsé par Orqea', 'https://orqea.example'],
      ['Développé par Erwann Laplante', 'https://github.com/ErwannL'],
    ])
    const en = html2doc(toHtml(r, 'en', 'https://o'))
    expect(en.querySelector('footer')?.textContent).toContain('Developed by Erwann Laplante')
  })
  it('chaque section présente', () => {
    const doc = html2doc(html)
    const ids = [...doc.querySelectorAll('main section')].map((s) => s.id)
    expect(ids).toEqual([
      'mutations',
      'baseline',
      'coverage',
      'capabilities',
      'issues',
      'acceptances',
      'not-covered',
      'limitations',
      'reproducibility',
    ])
    expect(doc.querySelector('#baseline')?.textContent).toContain(
      `${String(r.baseline.tests)} tests`,
    )
    expect(doc.querySelector('#reproducibility')?.textContent).toContain(
      `config=${r.reproducibility.configHash}`,
    )
    expect(doc.querySelector('#not-covered')?.textContent).toContain('Entrées non mutables')
    expect(doc.querySelector('#acceptances')?.textContent).toContain('Aucune acceptation.')
  })
  it('étiquette « partiel » selon le fait, pas selon les mutations en attente', () => {
    const partial = toHtml({ ...r, run: { ...r.run, partial: true } }, 'fr', 'https://o')
    expect(partial).toContain('<span class="badge">Partiel</span>')
    const full = toHtml(
      { ...r, run: { ...r.run, partial: false }, counts: { ...r.counts, pending: 0 } },
      'fr',
      'https://o',
    )
    expect(full).not.toContain('class="badge"')
    expect(full).toContain('Run complet')
    // Le fait (run.partial) prime : en attente sans réduction ⇒ pas d'étiquette, et inversement.
    const counts = { ...r.counts, pending: 0 }
    expect(toHtml({ ...r, counts, run: { ...r.run, partial: true } }, 'fr', 'https://o')).toContain(
      'class="badge"',
    )
    const pend = { ...r.counts, pending: 3 }
    expect(
      toHtml({ ...r, counts: pend, run: { ...r.run, partial: false } }, 'fr', 'https://o'),
    ).not.toContain('class="badge"')
  })
  it('capacités déclarées ET vérifiées, raisons traduites, code inconnu rendu tel quel', () => {
    const caps = capabilitiesOf(
      'jest',
      { coverage: true, mocks: false, observation: true, nouveau: true } as never,
      {
        at: '2026-10-01T00:00:00Z',
        checks: {
          coverage: { status: 'VERIFIED', reason: null },
          observation: { status: 'NOT_VERIFIED', reason: 'CODE_FUTUR' },
        },
      },
    )
    const doc = html2doc(toHtml({ ...r, capabilities: caps }, 'fr', 'https://o'))
    const rows = [...doc.querySelectorAll('#capabilities tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    )
    expect(rows).toEqual([
      ['Couverture', 'oui', 'Vérifiée', ''],
      ['Mocks', 'non', 'Non supportée', 'Non déclarée par l’adapter'],
      ['Observation des appels', 'oui', 'Non vérifiée', 'CODE_FUTUR'],
      ['nouveau', 'oui', 'Non vérifiée', 'Non vérifiée : lancer varia doctor'],
    ])
    expect(doc.querySelector('#capabilities')?.textContent).toContain('2026-10-01T00:00:00Z')
    expect(capabilitiesOf('x', { coverage: true }, undefined)).toEqual({
      adapter: 'x',
      declared: { coverage: true },
      verified: { coverage: { status: 'NOT_VERIFIED', reason: 'DOCTOR_NOT_RUN' } },
      verifiedAt: null,
    })
  })
  it('reproductibilité sans graine, commit ni branche ; limites ESM', () => {
    const doc = html2doc(
      toHtml(
        {
          ...r,
          reproducibility: { ...r.reproducibility, seed: null, gitCommit: null, gitBranch: null },
        },
        'fr',
        'https://o',
      ),
    )
    expect(doc.querySelector('#reproducibility')?.textContent).toContain('seed= ')
    expect(doc.querySelector('#reproducibility')?.textContent).toContain('commit=— branch=—')
    expect(limitationsOf('direct', { esm: true })).not.toContain('NATIVE_ESM_UNSUPPORTED')
    expect(limitationsOf('direct', {})).toContain('NATIVE_ESM_UNSUPPORTED')
  })
  it('acceptations, échecs de baseline, limite inconnue', () => {
    const doc = html2doc(
      toHtml(
        {
          ...r,
          resilienceRate: null,
          baseline: { ...r.baseline, failing: ['t <1>'] },
          limitations: ['LIMITE_FUTURE'],
          acceptances: [
            {
              id: 'acc1',
              source: 'cli',
              function: 'src/a.js#f',
              reason: 'voulu',
              status: 'EXPIRED',
              matched: 2,
            },
            {
              id: 'acc2',
              source: 'cli',
              function: 'src/a.js#g',
              path: '$[0]',
              reason: 'r',
              status: 'ACTIVE',
              matched: 0,
            },
          ],
        },
        'fr',
        'https://o',
      ),
    )
    expect(doc.querySelector('#acceptances')?.textContent).toContain(
      'src/a.js#f  — voulu (expirée, 2 mutations)',
    )
    expect(doc.querySelector('#acceptances')?.textContent).toContain(
      'src/a.js#g $[0] — r (active, 0 mutations)',
    )
    expect(doc.querySelector('#baseline')?.textContent).toContain('t <1>')
    expect(doc.querySelector('#limitations')?.textContent).toBe('LimitesLIMITE_FUTURE')
    expect(doc.querySelector('#mutations')?.textContent).toContain('Taux de résilience : —')
  })
})

describe('E-02 : rapport Markdown', () => {
  const r = report()
  it('partiel, capacités vérifiées, non couvert, limites', () => {
    const md = toMarkdown(
      {
        ...r,
        run: { ...r.run, partial: true },
        capabilities: capabilitiesOf('jest', { coverage: true, x: true } as never, {
          at: 'T',
          checks: { coverage: { status: 'NOT_VERIFIED', reason: 'COVERAGE_NOT_PRODUCED' } },
        }),
        limitations: ['INTERNAL_CALLS_NOT_OBSERVED', 'AUTRE'],
      },
      'en',
    )
    expect(md).toMatch(/^# Varia report — .* — \*\*Partial\*\*$/m)
    expect(md).toContain('Partial run:')
    expect(md).toContain('## Capabilities (jest)')
    expect(md).toContain('Verified by varia doctor on T.')
    expect(md).toContain(
      '| Coverage | yes | Not verified | The runner produced no coverage summary |',
    )
    expect(md).toContain('| x | yes | Not verified | Not verified: run varia doctor |')
    expect(md).toContain('## What was not tested')
    expect(md).toContain('- Non-mutable inputs (')
    expect(md).toContain('## Limitations')
    expect(md).toContain('- Internal same-module calls are not observed')
    expect(md).toContain('- AUTRE')
  })
  it('run complet, jamais vérifié, listes vides', () => {
    const md = toMarkdown(
      {
        ...r,
        run: { ...r.run, partial: false },
        capabilities: capabilitiesOf(
          'jest',
          { mocks: false, coverage: true },
          { checks: { coverage: { status: 'VERIFIED', reason: null } } },
        ),
        notCovered: {
          ...r.notCovered,
          neverCalled: [],
          skippedMutations: [{ id: 'm1', reason: 'x' }],
        },
      },
      'fr',
    )
    expect(md).not.toContain('**Partiel**')
    expect(md).toContain('Run complet')
    expect(md).toContain('Jamais vérifiées : lancer varia doctor.')
    expect(md).toContain('| Mocks | non | Non supportée | Non déclarée par l’adapter |')
    expect(md).toContain('| Couverture | oui | Vérifiée |  |')
    expect(md).toMatch(/^- .* \(0\)$/m)
    expect(md).toContain('- Mutations ignorées (1) : `m1`')
  })
})

describe('B-07 / C-01 : couverture inconnue, rapprochement d’issues', () => {
  const r = report()
  const i = r.issues[0] as Report['issues'][number]
  const rich: Report = {
    ...r,
    baselineCoverage: {
      status: 'COLLECTED',
      files: [{ file: 'src/a.js', lines: null, statements: 50, functions: null, branches: 100 }],
    },
    issues: [{ ...i, state: 'AMBIGUOUS_MATCH', matchedFrom: ['iss_a', 'iss_b'] }],
  }
  it('HTML : métrique inconnue « — », état traduit, issues rapprochées', () => {
    const doc = html2doc(toHtml(rich, 'fr', 'https://o'))
    const cells = [...doc.querySelectorAll('#coverage tbody td')].map((td) => td.textContent)
    expect(cells).toEqual(['src/a.js', '—', '50 %', '—', '100 %'])
    expect(doc.querySelector('#coverage')?.textContent).toContain('Collectée par le runner.')
    const issue = doc.querySelector('#issues tbody tr')?.textContent ?? ''
    expect(issue).toContain('rapprochement ambigu')
    expect(issue).toContain('rapprochée de iss_a, iss_b')
    const none = html2doc(
      toHtml({ ...r, baselineCoverage: { status: 'DISABLED', files: [] } }, 'en', 'https://o'),
    )
    expect(none.querySelector('#coverage table')).toBeNull()
    expect(none.querySelector('#coverage')?.textContent).toContain('Not collected (disabled).')
  })
  it('Markdown : idem', () => {
    const md = toMarkdown(rich, 'en')
    expect(md).toContain('| src/a.js | — | 50 % | — | 100 % |')
    expect(md).toContain('| File | Lines | Statements | Functions | Branches |')
    expect(md).toContain('ambiguous')
    expect(md).toContain('_(matched from iss_a, iss_b)_')
    expect(
      toMarkdown({ ...r, baselineCoverage: { status: 'UNAVAILABLE', files: [] } }, 'en'),
    ).toContain('Requested but not produced by the runner.')
  })
  it('JSON : matchedFrom par issue', () => {
    expect(r.issues.every((x) => Array.isArray(x.matchedFrom))).toBe(true)
  })
})
