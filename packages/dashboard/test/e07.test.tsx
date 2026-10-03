// @vitest-environment jsdom
import { buildServer } from '@varia/api'
import { SEED_RUN, seedDatabase } from '@varia/testkit'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.js'
import { trail } from '../src/pages/Trail.js'

const { dataDir } = seedDatabase()
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
  // Données chargées : plus aucun chargeur (le titre peut précéder les données sur une machine lente).
  await waitFor(() => expect(screen.queryByTestId('loader-logo')).toBeNull())
}
const crumbs = () =>
  within(screen.getByRole('navigation', { name: "Fil d'Ariane" }))
    .getAllByRole('listitem')
    .map((li) => li.textContent)
const follow = async (name: string | RegExp, heading: string | RegExp) => {
  const link = await screen.findByRole('link', { name })
  window.location.hash = String(link.getAttribute('href'))
  await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: heading })).toBeTruthy())
}

describe('E-07 : navigation Projet → Run → Dossier → Fichier → Test → Call site → Mutation → Erreur', () => {
  it('chaque niveau par lien, fil d’Ariane complet, URL partageable', async () => {
    await open(`#/runs/${SEED_RUN}/folders`, 'Dossiers de tests')
    expect(crumbs()).toEqual(['Projet', `Run ${SEED_RUN}`, 'Dossiers'])
    // Comptes : mutations ET défaillances écrites en chiffres (jamais la couleur seule).
    expect(await screen.findByRole('row', { name: /tests 2 2 7 3/ })).toBeTruthy()
    await follow('tests', 'Fichiers du dossier tests')
    await follow('tests/users.test.js', 'Tests du fichier tests/users.test.js')
    expect(crumbs()).toEqual([
      'Projet',
      `Run ${SEED_RUN}`,
      'Dossiers',
      'Dossier tests',
      'Fichier tests/users.test.js',
    ])
    await follow('createUser crée un utilisateur valide', /^Test : createUser/)
    await follow('src/users.js#createUser', /^Call site src\/users\.js#createUser/)
    expect(crumbs().at(-1)).toBe('Call site src/users.js#createUser')
    await follow('m_crash1', 'Mutation m_crash1')
    expect(crumbs()).toEqual([
      'Projet',
      `Run ${SEED_RUN}`,
      'Dossiers',
      'Dossier tests',
      'Fichier tests/users.test.js',
      'Test createUser crée un utilisateur valide',
      'Call site src/users.js#createUser',
      'Mutation m_crash1',
      'Erreur',
    ])
    expect(screen.getByRole('heading', { level: 2, name: 'Erreur' })).toBeTruthy()
    // URL partageable : un nouveau rendu à la même adresse redonne la même page.
    const url = window.location.hash
    cleanup()
    await open(url, 'Mutation m_crash1')
  })
  it('tests filtrés par dossier (?folder=) : filtre transmis au serveur et fil jusqu’au dossier', async () => {
    await open(`#/runs/${SEED_RUN}/tests?folder=tests`, 'Tests et call sites')
    expect(crumbs().at(-1)).toBe('Dossier tests')
    expect(calls.some((c) => c.includes('/tests?folder=tests'))).toBe(true)
  })
  it('mutation sans erreur : le fil s’arrête à la mutation (sans lien)', async () => {
    await open(`#/mutations/m_echo?run=${SEED_RUN}`, 'Mutation m_echo')
    const nav = screen.getByRole('navigation', { name: "Fil d'Ariane" })
    expect(within(nav).getByText('Mutation m_echo').tagName).toBe('SPAN')
    expect(within(nav).queryByText('Erreur')).toBeNull()
  })
  it('fil d’Ariane : dossier sans fichier, dernier élément sans lien', () => {
    const t = (k: string, p: Record<string, unknown> = {}) => `${k}${JSON.stringify(p)}`
    const items = trail(t as never, 'r', { folder: 'a/b' })
    expect(items.map((i) => i.path)).toEqual([
      [],
      ['runs', 'r'],
      ['runs', 'r', 'folders'],
      undefined,
    ])
    expect(trail(t as never, 'r', { file: 'x.test.js' }).map((i) => i.label)).toContain(
      'dash.crumb.folder{"name":"."}',
    )
  })
  it('call site dont le test est inconnu : fil sans test', async () => {
    const counts = { mutations: 0, crashes: 0, timeouts: 0, unexpected: 0 }
    fake['/api/v1/runs/r9/call-sites/c9'] = {
      runId: 'r9',
      callSite: {
        callSiteId: 'c9',
        testId: 't9',
        target: 'm#f',
        depth: 0,
        sequence: 2,
        nonDeterministic: false,
        counts,
      },
      test: null,
    }
    fake['/api/v1/runs/r9/mutations'] = { total: 0, limit: 50, offset: 0, items: [] }
    await open('#/runs/r9/call-sites/c9', 'Call site m#f (appel n° 2)')
    expect(crumbs()).toEqual(['Projet', 'Run r9', 'Dossiers', 'Call site m#f'])
  })
})

describe('E-07 : capacités et limites', () => {
  it('déclarées et vérifiées (rapport réel), libellés et raisons traduits, limites', async () => {
    await open(`#/runs/${SEED_RUN}/capabilities`, 'Capacités et limites du run')
    expect(await screen.findByText('Adaptateur : jest')).toBeTruthy()
    expect(screen.getByText('Jamais vérifiées : lancer varia doctor.')).toBeTruthy()
    const esm = within(screen.getByRole('row', { name: /^ESM/ }))
    expect(esm.getByText('Non')).toBeTruthy()
    expect(esm.getByText('Non supportée')).toBeTruthy()
    expect(esm.getByText(/Non déclarée par l’adapter/)).toBeTruthy()
    expect(screen.getByText('Appels internes à un même module non observés')).toBeTruthy()
  })
  it('date de vérification ; capacité ou raison inconnue : code brut ; sans vérification : « Non vérifié »', async () => {
    fake['/api/v1/runs/r9/capabilities'] = {
      adapter: 'a',
      declared: { esm: true, cjs: true, zz: false },
      verified: {
        esm: { status: 'VERIFIED', reason: null },
        cjs: { status: 'UNSUPPORTED', reason: 'CODE_X' },
      },
      verifiedAt: '2026-10-01',
      limitations: [],
    }
    await open('#/runs/r9/capabilities', 'Capacités et limites du run')
    expect(await screen.findByText('Vérifiées par varia doctor le 2026-10-01.')).toBeTruthy()
    const row = (name: string) => within(screen.getByRole('row', { name: new RegExp(`^${name}`) }))
    expect(row('ESM').getByText('Vérifiée')).toBeTruthy()
    expect(row('CommonJS').getByText('CODE_X')).toBeTruthy()
    expect(row('zz').getByText('Non vérifié')).toBeTruthy()
    cleanup()
    fake['/api/v1/runs/r9/capabilities'] = {
      adapter: 'a',
      declared: { esm: true },
      verified: null,
      verifiedAt: null,
      limitations: [],
    }
    await open('#/runs/r9/capabilities', 'Capacités et limites du run')
    expect(await screen.findByText('Non vérifié')).toBeTruthy()
    expect(screen.getByText('Oui')).toBeTruthy()
  })
})

describe('E-07 : pagination côté serveur, page dans l’URL', () => {
  const page = (n: number, limit: number, offset: number, item: (i: number) => unknown) => ({
    total: n,
    limit,
    offset,
    items: Array.from({ length: Math.min(limit, n - offset) }, (_, i) => item(offset + i)),
  })
  it.each([
    ['#/runs/r9/issues', '/api/v1/runs/r9/issues', 25, 'Issues'],
    ['#/runs', '/api/v1/runs', 25, 'Runs'],
    ['#/history', '/api/v1/history', 50, 'Historique des runs'],
    ['#/runs/r9/tests', '/api/v1/runs/r9/tests', 50, 'Tests et call sites'],
    ['#/runs/r9/folders', '/api/v1/runs/r9/folders', 50, 'Dossiers de tests'],
    ['#/runs/r9/folders/d', '/api/v1/runs/r9/files', 50, 'Fichiers du dossier d'],
    ['#/runs/r9/mutations', '/api/v1/runs/r9/mutations', 50, 'Mutations'],
  ])(
    '%s : « Suivant » écrit page=2 dans l’URL et demande offset au serveur',
    async (hash, api, limit, h) => {
      const counts = { mutations: 1, crashes: 0, timeouts: 0, unexpected: 0 }
      const item = (i: number) => ({
        id: `x${String(i)}`,
        state: 'COMPLETED',
        mode: 'normal',
        seed: 1,
        partial: false,
        createdAt: 'd',
        kind: 'CRASH',
        severity: 'HIGH',
        target: 'm#f',
        title: 't',
        errorName: 'E',
        message: 'm',
        frame: null,
        count: 1,
        mutationIds: [],
        issues: 0,
        critical: 0,
        counts: { ...counts, crashes: 0, timeouts: 0, mutations: 1 },
        testId: `t${String(i)}`,
        file: `f${String(i)}`,
        folder: `d${String(i)}`,
        name: `n${String(i)}`,
        status: 'PASSED',
        flaky: false,
        callSites: 0,
        tests: 1,
        files: 1,
        path: 'p',
        strategy: 's',
        subtype: null,
      })
      fake[api] = page(1000, limit, 0, item)
      await open(hash, h)
      fireEvent.click(await screen.findByRole('button', { name: 'Suivant' }))
      expect(window.location.hash).toMatch(/[?&]page=2$/)
      fake[api] = page(1000, limit, limit, item)
      await waitFor(() =>
        expect(calls.some((c) => c.startsWith(api) && c.includes(`offset=${String(limit)}`))).toBe(
          true,
        ),
      )
      // Jamais plus d'une page de lignes dans le DOM (liste paginée, pas 1 000 lignes).
      expect(document.querySelectorAll('main li, main tbody tr').length).toBeLessThanOrEqual(
        limit + 10,
      )
    },
  )
  it('test : call sites paginés ; non couvert : section et page dans l’URL', async () => {
    const counts = { mutations: 0, crashes: 0, timeouts: 0, unexpected: 0 }
    const site = (i: number) => ({
      callSiteId: `c${String(i)}`,
      testId: 't',
      target: `m#f${String(i)}`,
      depth: 0,
      sequence: i,
      nonDeterministic: false,
      counts,
    })
    fake['/api/v1/tests/t'] = {
      runId: 'r9',
      test: {
        testId: 't',
        file: 'f.js',
        folder: '.',
        name: 'n',
        status: 'passed',
        flaky: true,
        callSites: 80,
        counts,
      },
      callSites: page(80, 50, 0, site),
    }
    await open('#/runs/r9/tests/t?page=x', 'Test : n')
    expect(screen.getByText(/Instable/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    expect(window.location.hash).toBe('#/runs/r9/tests/t?page=2')
    cleanup()
    const empty = page(0, 25, 0, String)
    fake['/api/v1/runs/r9/not-covered'] = {
      sections: {
        neverCalled: page(60, 25, 0, (i) => `m#f${String(i)}`),
        transitiveOnly: empty,
        unsupported: empty,
        nonMutableInputs: page(1, 25, 0, () => ({
          target: 'm#f',
          path: 'arg0',
          reason: 'REDACTED',
        })),
        flakyTests: empty,
        mockedTargets: empty,
        skippedMutations: page(1, 25, 0, () => ({ id: 'm1', reason: 'R' })),
      },
      pendingMutations: 0,
      limitations: [],
    }
    await open('#/runs/r9/not-covered', "Ce qui n'a pas été testé")
    expect(await screen.findByText('m#f arg0 — REDACTED')).toBeTruthy()
    expect(screen.getByText('m1 — R')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    expect(window.location.hash).toBe('#/runs/r9/not-covered?section=neverCalled&page=2')
    await waitFor(() =>
      expect(calls.some((c) => c.includes('section=neverCalled&offset=25'))).toBe(true),
    )
  })
})

describe('B-07 / C-01 : métriques inconnues, états d’issue traduits, candidats rapprochés', () => {
  it('couverture de baseline : null affiché « — », jamais « null % »', async () => {
    fake['/api/v1/runs/r9/coverage'] = {
      baseline: {
        status: 'COLLECTED',
        files: [{ file: 'src/a.js', lines: 80, branches: null, functions: null }],
      },
      mutation: { targets: { discovered: 1, mutated: 1 }, inputs: { mutable: 1, mutated: 1 } },
    }
    await open('#/runs/r9/coverage', 'Couverture')
    const row = await screen.findByRole('row', { name: /src\/a\.js/ })
    expect(row.textContent).toBe('src/a.js80 %——')
  })
  it('détail d’issue : état traduit (réel) puis AMBIGUOUS_MATCH avec candidats', async () => {
    const id = (
      (await app.inject({ url: `/api/v1/runs/${SEED_RUN}/issues` })).json() as {
        items: { id: string }[]
      }
    ).items[0]?.id
    await open(`#/issues/${String(id)}?run=${SEED_RUN}`, /./)
    await waitFor(() =>
      expect(document.querySelector('[data-state]')?.textContent).toBe('nouvelle'),
    )
    cleanup()
    fake['/api/v1/issues/i9'] = {
      issue: {
        id: 'i9',
        kind: 'CRASH',
        severity: 'HIGH',
        target: 'm#f',
        title: 't',
        errorName: 'E',
        message: 'x',
        frame: null,
        count: 1,
        mutationIds: [],
        state: 'X',
      },
      occurrence: { state: 'AMBIGUOUS_MATCH', count: 1 },
      matchedFrom: ['i_a', 'i_b'],
      mutations: [],
    }
    await open('#/issues/i9', /./)
    expect(
      await screen.findByText(
        'rapprochement ambigu (plusieurs issues précédentes plausibles, aucune fusion)',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Issues précédentes rapprochées')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'i_b' }).getAttribute('href')).toBe('#/issues/i_b')
  })
})
