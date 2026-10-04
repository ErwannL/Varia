// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('signature DANS l’en-tête, sous le nom (comme les autres applications compagnes)', () => {
  it('« Propulsé par Orqea » et « Développé par Erwann Laplante » sont dans <header>, sous « Varia par Orqea »', async () => {
    await renderApp('fr')
    const header = document.querySelector('header') as HTMLElement
    const credits = screen.getByTestId('credits')
    expect(header.contains(credits)).toBe(true)
    const line = screen.getByTestId('byline').parentElement as HTMLElement
    // Les crédits suivent la ligne « Varia par Orqea » dans le même bloc de texte.
    expect(line.nextElementSibling).toBe(credits)
    expect(credits.querySelectorAll('a')).toHaveLength(2)
    expect(screen.getByTestId('powered-by').dataset['credit']).toBe('owner')
    expect(screen.getByTestId('author').dataset['credit']).toBe('author')
  })
  it('plus aucun pied de page', async () => {
    await renderApp('fr')
    expect(document.querySelector('footer')).toBeNull()
    expect(screen.getAllByTestId('powered-by')).toHaveLength(1)
  })
})

describe('E-04 / E-05 : byline hors lien, logo animé', () => {
  it('« par Orqea » : aucun ancêtre <a> ; « Varia » est le lien d’accueil', async () => {
    await renderApp('fr')
    const byline = screen.getByTestId('byline')
    expect(byline.closest('a')).toBeNull()
    const home = screen.getByRole('link', { name: 'Varia' })
    expect(home.getAttribute('href')).toBe('#/')
    expect(home.textContent).toBe('Varia')
  })
  it('chargeur : logo ANIMÉ pendant le chargement', async () => {
    let release: () => void = () => undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((ok) => {
            release = () => ok(new Response('{}', { status: 500 }))
          }),
      ),
    )
    render(<App locale="fr" />)
    const logo = screen.getByTestId('loader-logo')
    expect(logo.getAttribute('src')).toBe('/varia-animated.svg')
    expect(logo.getAttribute('alt')).toBe('')
    expect(screen.getByRole('status').textContent).toMatch(/Chargement/)
    release()
  })
  it('en-tête : logo animé au survol et au focus, fixe sinon', async () => {
    await renderApp('fr')
    const logo = screen.getByTestId('brand-logo')
    const link = screen.getByRole('link', { name: 'Varia' })
    expect(logo.getAttribute('src')).toBe('/varia.svg')
    fireEvent.mouseEnter(link)
    expect(logo.getAttribute('src')).toBe('/varia-animated.svg')
    fireEvent.mouseLeave(link)
    expect(logo.getAttribute('src')).toBe('/varia.svg')
    fireEvent.focus(link)
    expect(logo.getAttribute('src')).toBe('/varia-animated.svg')
    fireEvent.blur(link)
    expect(logo.getAttribute('src')).toBe('/varia.svg')
  })
})
