// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.js'
import { StatusBadge } from '../src/components/Common.js'
import { I18nProvider } from '../src/i18n.js'

const ORQEA = 'https://orqea.example'

function mockApi(orqeaUrl = ORQEA) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.startsWith('/health')
        ? { status: 'ok', name: 'varia', version: '0.1.0', orqeaUrl, database: true }
        : { total: 0, limit: 25, offset: 0, items: [] }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

beforeEach(() => mockApi())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderApp = async (locale: 'fr' | 'en') => {
  render(<App locale={locale} />)
  await waitFor(() => expect(screen.getByTestId('powered-by')).toBeTruthy())
}

describe('signature (prompt §4.1)', () => {
  it.each([
    [
      'fr',
      'par Orqea',
      'Propulsé par Orqea',
      'Développé par Erwann Laplante',
      '← Retour sur Orqea',
    ],
    ['en', 'by Orqea', 'Powered by Orqea', 'Developed by Erwann Laplante', '← Back to Orqea'],
  ] as const)('%s : textes, href, target, rel', async (locale, byline, powered, author, back) => {
    await renderApp(locale)
    expect(screen.getByTestId('byline').textContent).toBe(byline)
    const p = screen.getByTestId('powered-by')
    expect([p.textContent, p.getAttribute('href'), p.getAttribute('target')]).toEqual([
      powered,
      ORQEA,
      '_top',
    ])
    const a = screen.getByTestId('author')
    expect([
      a.textContent,
      a.getAttribute('href'),
      a.getAttribute('target'),
      a.getAttribute('rel'),
    ]).toEqual([author, 'https://github.com/ErwannL', '_blank', 'noreferrer noopener'])
    const b = screen.getByTestId('back-to-orqea')
    expect([b.textContent, b.getAttribute('href'), b.getAttribute('target')]).toEqual([
      back,
      ORQEA,
      '_top',
    ])
    expect(screen.getByText('Varia')).toBeTruthy()
  })
  it('orqeaUrl vient de /health', async () => {
    cleanup()
    mockApi('http://localhost:9999')
    await renderApp('fr')
    expect(screen.getByTestId('powered-by').getAttribute('href')).toBe('http://localhost:9999')
  })
  it('« nouvel onglet » / « new tab » n’apparaît nulle part (texte, aria-label, title)', async () => {
    for (const locale of ['fr', 'en'] as const) {
      await renderApp(locale)
      const html = document.body.innerHTML.toLowerCase()
      expect(html).not.toContain('nouvel onglet')
      expect(html).not.toContain('new tab')
      cleanup()
    }
  })
  it('« Retour sur Orqea » masqué dans une iframe, « Propulsé par Orqea » conservé', async () => {
    const top = window.top
    Object.defineProperty(window, 'top', { configurable: true, value: {} })
    try {
      await renderApp('fr')
      expect(screen.queryByTestId('back-to-orqea')).toBeNull()
      expect(screen.getByTestId('powered-by')).toBeTruthy()
    } finally {
      Object.defineProperty(window, 'top', { configurable: true, value: top })
    }
  })
  it('logo fixe dans l’en-tête', async () => {
    await renderApp('fr')
    expect(screen.getByTestId('brand-logo').getAttribute('src')).toBe('/varia.svg')
  })
})

describe('accessibilité', () => {
  it('état d’une mutation : icône ET libellé, jamais la couleur seule', () => {
    render(
      <I18nProvider locale="fr">
        <StatusBadge status="CRASH" />
        <StatusBadge status="PASSED" subtype="SUSPICIOUS_ACCEPT" />
        <StatusBadge status={null} />
      </I18nProvider>,
    )
    for (const [status, label] of [
      ['CRASH', 'Crash'],
      ['SUSPICIOUS_ACCEPT', 'Acceptation suspecte'],
      ['PENDING', 'Non exécutée'],
    ]) {
      const el = document.querySelector(`[data-status="${status}"]`)
      expect(el?.querySelector('svg path')).toBeTruthy()
      expect(el?.textContent).toBe(label)
    }
  })
  it('langue et thème : groupes de boutons, pas de menu déroulant natif', async () => {
    await renderApp('fr')
    expect(document.querySelectorAll('select').length).toBe(0)
    expect(screen.getAllByRole('radiogroup').length).toBeGreaterThanOrEqual(2)
  })
  it('lien d’évitement et navigation nommée', async () => {
    await renderApp('fr')
    expect(screen.getByText('Aller au contenu').getAttribute('href')).toBe('#main')
    expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeTruthy()
  })
})

describe('sources du dashboard', () => {
  const sources = [
    'App.tsx',
    'components/Brand.tsx',
    'components/Common.tsx',
    'pages/Issues.tsx',
    'pages/Mutations.tsx',
    'pages/NotCovered.tsx',
    'pages/NotFound.tsx',
    'pages/Overview.tsx',
    'pages/Runs.tsx',
  ].map((f) => readFileSync(`packages/dashboard/src/${f}`, 'utf8'))
  it('aucun dialogue natif, aucun <select>, aucune URL externe hors signature', () => {
    for (const s of sources) {
      expect(s).not.toMatch(/\b(alert|confirm|prompt)\(/)
      expect(s).not.toMatch(/<select/)
      expect(s.match(/https?:\/\/[^'"`\s]+/g) ?? []).toEqual(
        s.match(/https:\/\/(github\.com\/ErwannL|orqea\.dev)/g) ?? [],
      )
    }
  })
  it('index.html : titre, Open Graph, favicon, aucune ressource externe', () => {
    const html = readFileSync('packages/dashboard/index.html', 'utf8')
    expect(html).toContain('<title>Varia par Orqea</title>')
    expect(html).toMatch(/property="og:title" content="Varia par Orqea"/)
    expect(html).toMatch(/property="og:image" content="\/og-image.png"/)
    expect(html).toContain('rel="icon" href="/favicon.ico"')
    expect(html).not.toMatch(/(src|href)="https?:/)
  })
})
