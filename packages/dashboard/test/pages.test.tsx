// @vitest-environment jsdom
import { buildServer } from '@varia/api'
import { SEED_RUN, seedDatabase } from '@varia/testkit'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.js'

const { dataDir } = seedDatabase()
const { app } = buildServer({
  dataDir,
  env: { VARIA_ORQEA_URL: 'https://orqea.example' },
  dashboardDir: '/nonexistent',
})

beforeAll(() => {
  // Le dashboard parle à la VRAIE API (requêtes injectées, sans réseau).
  vi.stubGlobal(
    'fetch',
    async (
      url: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string },
    ) => {
      const r = await app.inject({
        method: (init?.method ?? 'GET') as 'GET',
        url,
        headers: { 'sec-fetch-site': 'same-origin', ...(init?.headers ?? {}) },
        ...(init?.body !== undefined ? { payload: init.body } : {}),
      })
      return new Response(r.statusCode === 204 ? null : r.body, {
        status: r.statusCode,
        headers: { 'content-type': String(r.headers['content-type'] ?? 'application/json') },
      })
    },
  )
})
afterAll(async () => {
  vi.unstubAllGlobals()
  await app.close()
})
afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const open = async (hash: string, heading: string | RegExp) => {
  window.location.hash = hash
  render(<App locale="fr" />)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: heading })).toBeTruthy())
  // Données chargées : plus aucun chargeur (le titre peut précéder les données sur une machine lente).
  await waitFor(() => expect(screen.queryByTestId('loader-logo')).toBeNull())
}

describe('pages du niveau 1 (CDC §26)', () => {
  it('vue d’ensemble : comptes bruts, run partiel, issue critique', async () => {
    await open('', "Vue d'ensemble")
    expect(
      screen.getByText(/7 mutations planifiées — 6 exécutées, 1 ignorées, 1 non exécutées/),
    ).toBeTruthy()
    expect(screen.getByText(/Run partiel/)).toBeTruthy()
    expect(screen.getByText(/1 issue\(s\) critique\(s\)/)).toBeTruthy()
  })
  it('runs : tableau paginé', async () => {
    await open('#/runs', 'Runs')
    expect(await screen.findByRole('link', { name: SEED_RUN })).toBeTruthy()
  })
  it('issues : filtre de gravité dans l’URL', async () => {
    await open(`#/runs/${SEED_RUN}/issues`, 'Issues')
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBe(3))
    fireEvent.click(screen.getByRole('radio', { name: 'Haute' }))
    expect(window.location.hash).toBe(`#/runs/${SEED_RUN}/issues?severity=HIGH`)
    cleanup()
    await open(window.location.hash, 'Issues')
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBe(1))
    expect(screen.getByText(/TypeError/)).toBeTruthy()
  })
  it('détail d’issue : cible, cadre, mutations avec état icône + libellé', async () => {
    const issues = (
      await app.inject({ url: `/api/v1/runs/${SEED_RUN}/issues?severity=HIGH` })
    ).json() as { items: { id: string }[] }
    await open(`#/issues/${issues.items[0]?.id ?? ''}?run=${SEED_RUN}`, /TypeError/)
    expect(screen.getAllByText('Crash').length).toBe(2)
    expect(screen.getByText('createUser (src/users.js:14)')).toBeTruthy()
  })
  it('mutations : filtre de statut', async () => {
    await open(`#/runs/${SEED_RUN}/mutations?status=CRASH`, 'Mutations')
    await waitFor(() => expect(screen.getAllByText('Crash').length).toBeGreaterThanOrEqual(2))
    expect(screen.queryByText('m_handled')).toBeNull()
  })
  it('détail de mutation : valeur hostile affichée comme texte, rejeu copiable', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await open(`#/mutations/m_echo?run=${SEED_RUN}`, 'Mutation m_echo')
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByText('"<script>alert(1)</script>"')).toBeTruthy()
    expect(screen.getByText('Acceptation suspecte')).toBeTruthy()
    expect(screen.getByText('varia replay m_echo')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copier' }))
    })
    expect(writeText).toHaveBeenCalledWith('varia replay m_echo')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copié' })).toBeTruthy())
  })
  it('non couvert : listes et limites traduites', async () => {
    await open(`#/runs/${SEED_RUN}/not-covered`, "Ce qui n'a pas été testé")
    expect(screen.getByText('src/math.js#helper')).toBeTruthy()
    expect(screen.getByText('Appels internes à un même module non observés')).toBeTruthy()
    expect(screen.getByText(/Mutations non exécutées : 1/)).toBeTruthy()
  })
  it('404 : page dédiée sous la signature', async () => {
    await open('#/nope/nope', 'Page introuvable')
    expect(screen.getByTestId('powered-by')).toBeTruthy()
  })
  it('changement de langue et de thème sans texte stocké', async () => {
    await open('#/runs', 'Runs')
    fireEvent.click(screen.getByRole('radio', { name: 'EN' }))
    await waitFor(() =>
      expect(screen.getByTestId('powered-by').textContent).toBe('Powered by Orqea'),
    )
    expect(document.documentElement.lang).toBe('en')
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.dataset['theme']).toBe('dark')
    expect(window.localStorage.getItem('varia.locale')).toBe('en')
  })
  it('erreur d’API affichée sans dialogue natif', async () => {
    await open('#/runs/zz', "Vue d'ensemble").catch(() => undefined)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/HTTP 404/))
  })
})

describe('pages du niveau 2 (CDC §26)', () => {
  it('historique : barre doublée d’un texte', async () => {
    await open('#/history', 'Historique des runs')
    expect(await screen.findByText(`${SEED_RUN} : 2 crashes, 1 timeouts, 3 issues`)).toBeTruthy()
  })
  it('comparaison : choix dans l’URL, même run refusé', async () => {
    await open(`#/compare?a=${SEED_RUN}&b=${SEED_RUN}`, 'Comparer deux runs')
    expect(screen.getByText('Choisissez deux runs différents.')).toBeTruthy()
    const radios = await screen.findAllByRole('radio', { name: SEED_RUN })
    expect(radios).toHaveLength(2)
    expect(radios.every((r) => r.getAttribute('aria-checked') === 'true')).toBe(true)
  })
  it('acceptations : création puis suppression confirmée en ligne', async () => {
    await open('#/acceptances', 'Acceptations')
    await screen.findByText(/Aucune acceptation en base/)
    fireEvent.change(screen.getByLabelText('Fonction (export ou module#export)'), {
      target: { value: 'createUser' },
    })
    fireEvent.change(screen.getByLabelText('Raison'), { target: { value: 'domaine' } })
    await act(async () => {
      fireEvent.submit(
        screen
          .getByRole('button', { name: "Ajouter l'acceptation" })
          .closest('form') as HTMLFormElement,
      )
    })
    expect(await screen.findByText(/Acceptation enregistrée/)).toBeTruthy()
    expect(await screen.findByText('domaine')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmer la suppression' }))
    })
    expect(await screen.findByText(/Aucune acceptation en base/)).toBeTruthy()
  })
  it('acceptation invalide : message, rien d’enregistré', async () => {
    await open('#/acceptances', 'Acceptations')
    await act(async () => {
      fireEvent.submit(
        screen
          .getByRole('button', { name: "Ajouter l'acceptation" })
          .closest('form') as HTMLFormElement,
      )
    })
    expect(await screen.findByText('Fonction et raison sont obligatoires.')).toBeTruthy()
  })
  it('tests et call sites', async () => {
    await open(`#/runs/${SEED_RUN}/tests`, 'Tests et call sites')
    expect(
      await screen.findByRole('link', { name: 'createUser crée un utilisateur valide' }),
    ).toBeTruthy()
    expect(screen.getByText(/instable/)).toBeTruthy()
  })
  it('couverture : statut honnête', async () => {
    await open(`#/runs/${SEED_RUN}/coverage`, 'Couverture')
    expect(await screen.findByText(/Désactivée/)).toBeTruthy()
  })
})
