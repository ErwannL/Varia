// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, DEFAULT_ORQEA_URL } from '../src/App.js'
import { Pager, SeverityBadge, Value } from '../src/components/Common.js'
import { I18nProvider, LOCALE_KEY, useI18n } from '../src/i18n.js'
import { inIframe } from '../src/router.js'

// API simulée : chaque test décrit les réponses (chemin → corps, ou statut d'erreur).
type Reply = unknown | { status: number } | Error | string
let routes: Record<string, Reply> = {}
const calls: string[] = []

const HEALTH = { status: 'ok', name: 'varia', version: '0', orqeaUrl: 'https://o.example' }
const RUN = {
  id: 'r1',
  state: 'COMPLETED',
  mode: 'full',
  seed: null,
  partial: false,
  createdAt: '2026-01-01',
}
const page = <T,>(items: T[], total = items.length, limit = 25, offset = 0) => ({
  total,
  limit,
  offset,
  items,
})

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const key = Object.keys(routes).find((k) => url === k || url.startsWith(`${k}?`))
      const r = key === undefined ? { status: 404 } : routes[key]
      if (typeof r === 'string') throw r
      if (r instanceof Error) throw r
      if (typeof r === 'object' && r !== null && 'status' in r && Object.keys(r).length === 1)
        return new Response('{}', { status: (r as { status: number }).status })
      return new Response(JSON.stringify(r), { status: 200 })
    }),
  )
}

beforeEach(() => {
  routes = { '/health': HEALTH, '/api/v1/runs': page([RUN]) }
  calls.length = 0
  stubFetch()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.location.hash = ''
  window.localStorage.clear()
})

const show = async (hash: string, heading: string | RegExp, locale: 'fr' | 'en' = 'fr') => {
  window.location.hash = hash
  render(<App locale={locale} />)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: heading })).toBeTruthy())
  // Données chargées : plus aucun chargeur (le titre peut précéder les données sur une machine lente).
  await waitFor(() => expect(screen.queryByTestId('loader-logo')).toBeNull())
}

describe('langue initiale (sans langue imposée)', () => {
  it('langue mémorisée « en » prioritaire', async () => {
    window.localStorage.setItem(LOCALE_KEY, 'en')
    render(<App />)
    expect((await screen.findByTestId('powered-by')).textContent).toBe('Powered by Orqea')
  })
  it('langue mémorisée « fr » prioritaire sur un navigateur anglais', async () => {
    window.localStorage.setItem(LOCALE_KEY, 'fr')
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
    render(<App />)
    expect((await screen.findByTestId('powered-by')).textContent).toBe('Propulsé par Orqea')
    vi.restoreAllMocks()
  })
  it.each([
    ['en-GB', 'Powered by Orqea'],
    ['de-DE', 'Propulsé par Orqea'],
  ])('valeur mémorisée invalide : langue du navigateur %s', async (lang, text) => {
    window.localStorage.setItem(LOCALE_KEY, 'xx')
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(lang)
    render(<App />)
    expect((await screen.findByTestId('powered-by')).textContent).toBe(text)
    vi.restoreAllMocks()
  })
  it('stockage indisponible : langue du navigateur, et changement de langue sans erreur', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqué')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqué')
    })
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
    render(<App />)
    expect((await screen.findByTestId('powered-by')).textContent).toBe('Powered by Orqea')
    fireEvent.click(screen.getByRole('radio', { name: 'FR' }))
    expect(screen.getByTestId('powered-by').textContent).toBe('Propulsé par Orqea')
    fireEvent.click(screen.getByRole('radio', { name: 'Sombre' }))
    expect(document.documentElement.dataset['theme']).toBe('dark')
    vi.restoreAllMocks()
  })
  it('useI18n hors fournisseur : erreur explicite', () => {
    const Bad = () => <>{useI18n().locale}</>
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Bad />)).toThrow('I18nProvider manquant')
    vi.restoreAllMocks()
  })
})

describe('coquille : santé et dernier run', () => {
  it('/health en erreur : lien Orqea par défaut ; aucun run : menu réduit', async () => {
    routes = { '/health': { status: 500 }, '/api/v1/runs': { status: 500 } }
    window.location.hash = '#/history'
    render(<App locale="fr" />)
    const p = await screen.findByTestId('powered-by')
    expect(p.getAttribute('href')).toBe(DEFAULT_ORQEA_URL)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/HTTP 404/))
    expect(screen.queryByRole('link', { name: 'Issues' })).toBeNull()
  })
  it('liste de runs vide : menu sans pages de run, vue d’ensemble vide', async () => {
    routes['/api/v1/runs'] = page([])
    render(<App locale="fr" />)
    expect(await screen.findByText(/Aucun run pour ce projet/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Issues' })).toBeNull()
  })
  it('rejet non-Error du réseau : message affiché tel quel', async () => {
    routes['/api/v1/runs/r1/summary'] = 'réseau coupé'
    await show('#/runs/r1', /./).catch(() => undefined)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/réseau coupé/))
  })
})

describe('en-tête', () => {
  it('logo animé au survol et au focus, fixe sinon', async () => {
    render(<App locale="fr" />)
    const logo = await screen.findByTestId('brand-logo')
    const link = logo.closest('a') as HTMLElement
    fireEvent.mouseEnter(link)
    expect(logo.getAttribute('src')).toBe('/varia-animated.svg')
    fireEvent.mouseLeave(link)
    expect(logo.getAttribute('src')).toBe('/varia.svg')
    fireEvent.focus(link)
    expect(logo.getAttribute('src')).toBe('/varia-animated.svg')
    fireEvent.blur(link)
    expect(logo.getAttribute('src')).toBe('/varia.svg')
  })
  it('iframe d’une autre origine (accès à top refusé) : considérée comme intégrée', () => {
    const w = {
      get self() {
        return w
      },
      get top(): Window {
        throw new Error('SecurityError')
      },
    } as unknown as Window
    expect(inIframe(w)).toBe(true)
  })
})

describe('composants communs', () => {
  it('pagination : suivant puis précédent, bornes désactivées', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <I18nProvider locale="fr">
        <Pager total={30} limit={25} offset={0} onChange={onChange} />
      </I18nProvider>,
    )
    expect(screen.getByText('1–25 sur 30')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Précédent' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    expect(onChange).toHaveBeenLastCalledWith(25)
    rerender(
      <I18nProvider locale="fr">
        <Pager total={30} limit={25} offset={25} onChange={onChange} />
      </I18nProvider>,
    )
    expect(screen.getByText('26–30 sur 30')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Suivant' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Précédent' }))
    expect(onChange).toHaveBeenLastCalledWith(0)
  })
  it('valeur undefined affichée « undefined », gravité INFO marquée', () => {
    render(
      <I18nProvider locale="en">
        <Value value={undefined} />
        <SeverityBadge severity="INFO" />
      </I18nProvider>,
    )
    expect(screen.getByText('undefined')).toBeTruthy()
    expect(document.querySelector('[data-severity="INFO"] .sev-mark')?.textContent).toBe('i')
  })
})

const ISSUE = {
  id: 'i1',
  kind: 'OTHER_KIND',
  severity: 'LOW',
  state: 'NEW',
  target: 'src/a.js#f',
  title: 'Titre brut',
  errorName: null,
  message: null,
  frame: null,
  count: 1,
  mutationIds: ['m1'],
}
const MROW = {
  id: 'm1',
  target: 'src/a.js#f',
  test: 't',
  path: '$[0]',
  strategy: 'delete',
  original: 1,
  value: 2,
  deleted: true,
  status: null,
  subtype: null,
  reason: null,
  error: null,
}

describe('issues', () => {
  it('liste vide pour un filtre, retour à « Toutes » retire le filtre de l’URL', async () => {
    routes['/api/v1/runs/r1/issues'] = page([])
    await show('#/runs/r1/issues?severity=HIGH', 'Issues')
    expect(await screen.findByText('Aucune issue pour ce filtre.')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Toutes' }))
    expect(window.location.hash).toBe('#/runs/r1/issues')
  })
  it('détail sans run, sans cadre, sans occurrence ; propriété supprimée', async () => {
    routes['/api/v1/issues/i1'] = {
      issue: ISSUE,
      occurrence: null,
      matchedFrom: [],
      mutations: [MROW],
    }
    await show('#/issues/i1', 'Titre brut')
    expect(calls).toContain('/api/v1/issues/i1')
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'm1' }).getAttribute('href')).toBe('#/mutations/m1')
    expect(screen.getByText('undefined')).toBeTruthy()
    expect(screen.getByText('Non exécutée')).toBeTruthy()
  })
})

const DETAIL = {
  runId: 'r1',
  mutation: {
    id: 'm1',
    module: 'src/a.js',
    export: 'f',
    testName: 'cas',
    pathStr: '$.x',
    strategy: 'delete',
    original: 1,
    value: null,
    op: 'delete',
  },
  result: null,
  replay: 'varia replay m1',
}

describe('mutations', () => {
  it('sans filtre : « Toutes » actif ; choisir puis retirer un statut', async () => {
    routes['/api/v1/runs/r1/mutations'] = page([MROW])
    await show('#/runs/r1/mutations', 'Mutations')
    expect(screen.getByRole('radio', { name: 'Toutes' }).getAttribute('aria-checked')).toBe('true')
    expect(calls).toContain('/api/v1/runs/r1/mutations?limit=50&offset=0')
    fireEvent.click(screen.getByRole('radio', { name: 'Crash' }))
    expect(window.location.hash).toBe('#/runs/r1/mutations?status=CRASH')
    fireEvent.click(screen.getByRole('radio', { name: 'Toutes' }))
    expect(window.location.hash).toBe('#/runs/r1/mutations')
  })
  it('détail sans run ni résultat : non exécutée, propriété supprimée, pas d’erreur', async () => {
    routes['/api/v1/mutations/m1'] = DETAIL
    await show('#/mutations/m1', 'Mutation m1')
    expect(calls).toContain('/api/v1/mutations/m1')
    expect(screen.getByText('Non exécutée')).toBeTruthy()
    expect(screen.getByText('(propriété supprimée)')).toBeTruthy()
    expect(screen.queryByText('Raison')).toBeNull()
    expect(screen.queryByText('Erreur')).toBeNull()
  })
  it('détail avec raison sans chemin d’écho, erreur avec pile', async () => {
    routes['/api/v1/mutations/m1'] = {
      ...DETAIL,
      mutation: { ...DETAIL.mutation, op: 'set', value: 'v' },
      result: {
        status: 'CRASH',
        subtype: null,
        reason: 'motif',
        echoPath: null,
        error: { name: 'TypeError', message: 'boum', stack: 'at f (a.js:1)' },
      },
    }
    await show('#/mutations/m1?run=r1', 'Mutation m1')
    expect(screen.getByText('motif').querySelector('code')).toBeNull()
    expect(screen.getByText('TypeError: boum')).toBeTruthy()
    expect(screen.getByText('at f (a.js:1)')).toBeTruthy()
    expect(screen.getByText('"v"')).toBeTruthy()
  })
  it('erreur sans pile : pas de section « Pile »', async () => {
    routes['/api/v1/mutations/m1'] = {
      ...DETAIL,
      result: {
        status: 'CRASH',
        subtype: null,
        reason: 'motif',
        echoPath: '$.x',
        error: { name: 'Error', message: 'non' },
      },
    }
    await show('#/mutations/m1', 'Mutation m1')
    expect(screen.getByText('Error: non')).toBeTruthy()
    expect(screen.queryByText('Pile')).toBeNull()
  })
})

const SUMMARY = {
  run: RUN,
  counts: {
    mutations: 0,
    handled: 0,
    expected: 0,
    passed: 0,
    suspicious: 0,
    unexpected: 0,
    crashes: 0,
    timeouts: 0,
    skipped: 0,
    infra: 0,
    pending: 0,
  },
  resilienceRate: null,
  coverage: { targets: { discovered: 0, mutated: 0 }, inputs: { mutable: 0, mutated: 0 } },
  issues: 0,
  critical: 0,
}

describe('vue d’ensemble, runs, tests, non couvert', () => {
  it('run sans graine, sans critique, complet, taux non calculable', async () => {
    routes['/api/v1/runs/r1/summary'] = SUMMARY
    await show('#/runs/r1', "Vue d'ensemble")
    expect(screen.getByText('Run r1 · graine — · COMPLETED')).toBeTruthy()
    expect(screen.getByText('Taux de résilience : non calculable')).toBeTruthy()
    expect(screen.queryByText(/critique/)).toBeNull()
    expect(screen.queryByText(/Run partiel/)).toBeNull()
  })
  it('runs : liste vide puis run sans graine', async () => {
    routes['/api/v1/runs'] = page([])
    await show('#/runs', 'Runs')
    expect(await screen.findByText(/Aucun run pour ce projet/)).toBeTruthy()
    cleanup()
    routes['/api/v1/runs'] = page([RUN])
    await show('#/runs', 'Runs')
    expect(await screen.findByRole('cell', { name: '—' })).toBeTruthy()
  })
  it('test : call site à entrée non déterministe signalé', async () => {
    const counts = { mutations: 0, crashes: 0, timeouts: 0, unexpected: 0 }
    routes['/api/v1/tests/t1'] = {
      runId: 'r1',
      test: {
        testId: 't1',
        file: 'a.test.js',
        folder: '.',
        name: 'cas',
        status: 'passed',
        flaky: false,
        callSites: 1,
        counts,
      },
      callSites: page([
        {
          callSiteId: 'c1',
          testId: 't1',
          target: 'src/a.js#f',
          depth: 0,
          sequence: 1,
          nonDeterministic: true,
          counts,
        },
      ]),
    }
    await show('#/runs/r1/tests/t1', 'Test : cas')
    expect(await screen.findByText(/entrée non déterministe/)).toBeTruthy()
    expect(screen.getByText(/Stable/)).toBeTruthy()
  })
  it('non couvert : listes vides affichées « Rien. »', async () => {
    const empty = page([])
    routes['/api/v1/runs/r1/not-covered'] = {
      sections: {
        neverCalled: empty,
        transitiveOnly: empty,
        unsupported: empty,
        nonMutableInputs: empty,
        flakyTests: empty,
        mockedTargets: empty,
        skippedMutations: empty,
      },
      pendingMutations: 0,
      limitations: [],
    }
    await show('#/runs/r1/not-covered', "Ce qui n'a pas été testé")
    expect(screen.getAllByText('Rien.')).toHaveLength(7)
  })
  it('non couvert : cible mockée affichée avec son fichier de test (E-03)', async () => {
    const empty = page([])
    routes['/api/v1/runs/r1/not-covered'] = {
      sections: {
        neverCalled: empty,
        transitiveOnly: empty,
        unsupported: empty,
        nonMutableInputs: empty,
        flakyTests: empty,
        mockedTargets: page([{ module: 'src/users.js', testFile: 'tests/automock.test.js' }]),
        skippedMutations: empty,
      },
      pendingMutations: 0,
      limitations: [],
    }
    await show('#/runs/r1/not-covered', "Ce qui n'a pas été testé")
    expect(
      screen.getByText('Cibles mockées par un test (non observées dans ce test) (1)'),
    ).toBeTruthy()
    expect(screen.getByText('src/users.js — tests/automock.test.js')).toBeTruthy()
  })
})

describe('comparaison et acceptations', () => {
  it('run manquant : chaque choix ne fixe que son côté', async () => {
    routes['/api/v1/runs'] = page([RUN, { ...RUN, id: 'r2' }])
    await show('#/compare', 'Comparer deux runs')
    const [before] = await screen.findAllByRole('radio', { name: 'r1' })
    expect(
      screen
        .getAllByRole('radio', { name: /^r\d$/ })
        .every((r) => r.getAttribute('aria-checked') === 'false'),
    ).toBe(true)
    fireEvent.click(before as HTMLElement)
    expect(window.location.hash).toBe('#/compare?a=r1')
    cleanup()
    window.location.hash = '#/compare?b=r2'
    render(<App locale="fr" />)
    const [first, second] = await screen.findAllByRole('radio', { name: 'r1' })
    fireEvent.click(second as HTMLElement)
    expect(window.location.hash).toBe('#/compare?b=r1')
    fireEvent.click(first as HTMLElement)
    expect(window.location.hash).toBe('#/compare?a=r1&b=r2')
  })
  it('diff : nouvelles issues liées au run comparé, issues modifiées', async () => {
    routes['/api/v1/runs/r2/diff'] = {
      diff: {
        added: ['i9'],
        removed: [],
        changed: [{ id: 'i3', before: 1, after: 4 }],
        unchanged: [],
      },
    }
    await show('#/compare?a=r1&b=r2', 'Comparer deux runs')
    const link = await screen.findByRole('link', { name: 'i9' })
    expect(link.getAttribute('href')).toBe('#/issues/i9?run=r2')
    expect(screen.getByText('~ i3 : 1 → 4')).toBeTruthy()
  })
  it('acceptation avec échéance : date affichée', async () => {
    routes['/api/v1/acceptances'] = [
      {
        id: 'a1',
        function: 'f',
        path: '$.x',
        strategy: 'null',
        reason: 'r',
        owner: null,
        expires: '2027-01-01',
      },
    ]
    await show('#/acceptances', 'Acceptations')
    expect(await screen.findByText('2027-01-01')).toBeTruthy()
    expect(screen.getByText('f $.x null')).toBeTruthy()
    await act(async () => undefined)
  })
})
