// @vitest-environment jsdom
import { buildServer } from '@varia/api'
import { SEED_RUN, SEED_RUN_2, seedDatabase } from '@varia/testkit'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.js'

// Q-02 : lanceur (adaptateur + version), extensions chargées et défaillances PLUGIN_FAILURE.
const { dataDir } = seedDatabase(undefined, { second: true })
const { app } = buildServer({ dataDir, env: {}, dashboardDir: '/nonexistent' })
const calls: string[] = []
/** Réponses simulées (prioritaires) ; sinon la VRAIE API (requêtes injectées, sans réseau). */
let fake: Record<string, unknown> = {}

beforeEach(() => {
  fake = {}
  calls.length = 0
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    const key = Object.keys(fake).find((k) => url === k || url.startsWith(`${k}?`))
    if (key !== undefined) return new Response(JSON.stringify(fake[key]), { status: 200 })
    const r = await app.inject({ url, headers: { 'sec-fetch-site': 'same-origin' } })
    return new Response(r.body, { status: r.statusCode })
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.location.hash = ''
})
afterAll(() => app.close())

const open = async (hash: string, heading: string | RegExp) => {
  window.location.hash = hash
  render(<App locale="fr" />)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: heading })).toBeTruthy())
  await waitFor(() => expect(screen.queryByTestId('loader-logo')).toBeNull())
}

describe('Q-02 : lanceur du run (capacités)', () => {
  it('version du lanceur affichée (rapport réel) ; absente : « non détectée »', async () => {
    await open(`#/runs/${SEED_RUN}/capabilities`, 'Capacités et limites du run')
    expect(screen.getByText('Adaptateur : jest')).toBeTruthy()
    expect(screen.getByTestId('runner-version').textContent).toBe('Version du lanceur : 29.7.0')
    cleanup()
    await open(`#/runs/${SEED_RUN_2}/capabilities`, 'Capacités et limites du run')
    expect(screen.getByTestId('runner-version').textContent).toBe(
      'Version du lanceur : non détectée',
    )
  })
})

describe('Q-02 : extensions et défaillances PLUGIN_FAILURE', () => {
  it('navigation : lien « Extensions » ; vue d’ensemble : compteur relié à la page', async () => {
    await open(`#/runs/${SEED_RUN}`, "Vue d'ensemble")
    const nav = within(screen.getByRole('navigation', { name: /principale|navigation/i }))
    expect(nav.getByRole('link', { name: 'Extensions' }).getAttribute('href')).toBe(
      `#/runs/${SEED_RUN}/plugins`,
    )
    const tile = screen.getByRole('link', { name: "Défaillances d'extension" })
    expect(tile.getAttribute('href')).toBe(`#/runs/${SEED_RUN}/plugins`)
    expect(tile.closest('.count')?.querySelector('dd')?.textContent).toBe('2')
  })
  it('extensions chargées : nom, source, version déclarée ou « non déclarée », apiVersion, contributions', async () => {
    await open(`#/runs/${SEED_RUN}/plugins`, 'Extensions du run')
    expect(screen.getByRole('heading', { level: 2, name: 'Extensions chargées (2)' })).toBeTruthy()
    const row = within(screen.getByRole('row', { name: /^iban/ }))
    expect(row.getByText('./plugins/iban.mjs')).toBeTruthy()
    expect(row.getByText('1.2.0')).toBeTruthy()
    expect(
      within(screen.getByRole('row', { name: /^codes/ })).getByText("Non déclarée par l'extension"),
    ).toBeTruthy()
    expect(row.getByText('1')).toBeTruthy()
    const items = row.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual([
      'iban/invalid-iban · Stratégie · active',
      'iban/csv · Rapporteur · désactivée après une erreur',
    ])
  })
  it('défaillances : badge icône + libellé, faits traduits, compteurs par phase', async () => {
    await open(`#/runs/${SEED_RUN}/plugins`, 'Extensions du run')
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: "Défaillances d'extension — PLUGIN_FAILURE (2)",
      }),
    ).toBeTruthy()
    const radios = screen.getAllByRole('radio').map((r) => r.textContent)
    expect(radios).toEqual(
      expect.arrayContaining([
        'Toutes (2)',
        'Chargement (1)',
        'Planification (0)',
        'Fuzzing (0)',
        'Rapport (1)',
      ]),
    )
    const cards = screen.getAllByRole('listitem').filter((li) => li.classList.contains('card'))
    expect(cards).toHaveLength(2)
    const first = within(cards[0] as HTMLElement)
    const badge = (cards[0] as HTMLElement).querySelector('[data-status=PLUGIN_FAILURE]')
    expect(badge?.querySelector('svg path')?.getAttribute('d')).toBeTruthy()
    expect(badge?.textContent).toBe("Défaillance d'extension")
    expect(first.getByText('./plugins/absent.mjs')).toBeTruthy()
    expect(first.getByText('—')).toBeTruthy()
    expect(first.getByText('Chargement')).toBeTruthy()
    expect(first.getByText('Introuvable')).toBeTruthy()
    expect(first.getByText('introuvable : ./plugins/absent.mjs')).toBeTruthy()
    const second = within(cards[1] as HTMLElement)
    expect(second.getByText('iban/csv')).toBeTruthy()
    expect(second.getByText('Exception levée')).toBeTruthy()
  })
  it('filtre de phase dans l’URL, transmis au serveur ; retour à « Toutes »', async () => {
    await open(`#/runs/${SEED_RUN}/plugins`, 'Extensions du run')
    fireEvent.click(screen.getByRole('radio', { name: 'Rapport (1)' }))
    expect(window.location.hash).toBe(`#/runs/${SEED_RUN}/plugins?phase=report`)
    cleanup()
    await open(window.location.hash, 'Extensions du run')
    expect(calls.some((u) => u.endsWith('&phase=report'))).toBe(true)
    expect(screen.getByRole('radio', { name: 'Rapport (1)' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(screen.queryByText('./plugins/absent.mjs')).toBeNull()
    expect(screen.getByText('Exception levée')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Planification (0)' }))
    cleanup()
    await open(window.location.hash, 'Extensions du run')
    expect(screen.getByText("Aucune défaillance d'extension pour ce filtre.")).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Toutes (2)' }))
    expect(window.location.hash).toBe(`#/runs/${SEED_RUN}/plugins`)
  })
  it('run sans extension : états vides dits, compteur à 0', async () => {
    await open(`#/runs/${SEED_RUN_2}/plugins`, 'Extensions du run')
    expect(screen.getByText('Aucune extension chargée pendant ce run.')).toBeTruthy()
    expect(screen.getByText("Aucune défaillance d'extension pour ce filtre.")).toBeTruthy()
    cleanup()
    await open(`#/runs/${SEED_RUN_2}`, "Vue d'ensemble")
    const tile = screen.getByRole('link', { name: "Défaillances d'extension" })
    expect(tile.closest('.count')?.querySelector('dd')?.textContent).toBe('0')
  })
  it('code inconnu rendu brut (donnée) ; pagination des défaillances', async () => {
    const failure = (i: number) => ({
      origin: 'PLUGIN_FAILURE',
      plugin: `p${String(i)}`,
      extension: null,
      phase: 'fuzz',
      code: 'CODE_FUTUR',
      message: `m${String(i)}`,
    })
    fake['/api/v1/runs/r9/plugins'] = {
      loaded: [],
      byPhase: { load: 0, plan: 0, fuzz: 30, report: 0 },
      failures: {
        total: 30,
        limit: 25,
        offset: 0,
        items: Array.from({ length: 25 }, (_, i) => failure(i)),
      },
    }
    await open('#/runs/r9/plugins', 'Extensions du run')
    expect(screen.getAllByText('CODE_FUTUR')).toHaveLength(25)
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    expect(window.location.hash).toBe('#/runs/r9/plugins?page=2')
  })
})
