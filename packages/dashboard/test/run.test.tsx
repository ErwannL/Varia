// @vitest-environment jsdom
import { buildServer } from '@varia/api'
import { JOB_LIMITS } from '@varia/engine'
import { seedDatabase } from '@varia/testkit'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EventEmitter } from 'node:events'
import { writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.js'

class Child extends EventEmitter {
  pid = 7
}
const children: Child[] = []
let output = ''
const killed: number[] = []

const { dataDir } = seedDatabase()
const readOnly = buildServer({ dataDir, env: {}, dashboardDir: '/nonexistent' })
const runner = buildServer({
  dataDir,
  env: {},
  dashboardDir: '/nonexistent',
  run: {
    command: ['node', 'varia.js'],
    globalArgs: [],
    cwd: tmpdir(),
    env: {},
    info: { name: 'demo-projet', root: '/projet', config: null },
    kill: (pid) => killed.push(pid),
    spawn: ((_b: string, _a: string[], o: { stdio: unknown[] }) => {
      if (output !== '') writeSync(o.stdio[1] as number, output)
      const c = new Child()
      children.push(c)
      return c
    }) as never,
  },
})
let current = readOnly
let failJobs = false

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    async (
      url: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string },
    ) => {
      if (failJobs && url === '/api/v1/jobs') throw new Error('réseau coupé')
      const r = await current.app.inject({
        method: (init?.method ?? 'GET') as 'GET',
        url,
        headers: { 'sec-fetch-site': 'same-origin', ...(init?.headers ?? {}) },
        ...(init?.body !== undefined ? { payload: init.body } : {}),
      })
      return new Response(r.body, {
        status: r.statusCode,
        headers: { 'content-type': String(r.headers['content-type'] ?? 'application/json') },
      })
    },
  )
})
afterAll(async () => {
  vi.unstubAllGlobals()
  await readOnly.app.close()
  await runner.app.close()
})
afterEach(() => {
  cleanup()
  window.location.hash = ''
  failJobs = false
  output = ''
})

const open = async (server: typeof readOnly) => {
  current = server
  window.location.hash = '#/run'
  render(<App locale="fr" />)
  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 1, name: 'Lancer Varia' })).toBeTruthy(),
  )
  await waitFor(() => expect(screen.queryByTestId('loader-logo')).toBeNull())
}
const form = (title: string) => screen.getByRole('heading', { name: title }).closest('form')
const submit = async (title: string) => {
  await act(async () => {
    fireEvent.submit(form(title) as HTMLFormElement)
  })
}
const finish = async (code: number | null) => {
  await act(async () => {
    children.at(-1)?.emit('exit', code)
  })
}

describe('page Lancer : lecture seule par défaut', () => {
  it('explique comment l’activer et propose les commandes équivalentes', async () => {
    await open(readOnly)
    expect(screen.getByText(/lecture seule/)).toBeTruthy()
    expect(screen.getByText('varia dashboard --allow-run')).toBeTruthy()
    expect(screen.getByText(/varia test --quick/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Lancer la baseline/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Lancer' })).toBeTruthy()
  })
})

describe('page Lancer : --allow-run', () => {
  it('baseline : travail en cours, boutons bloqués, fin détectée par relecture, lien vers les résultats', async () => {
    await open(runner)
    expect(await screen.findByText('Projet : demo-projet')).toBeTruthy()
    expect(screen.getByText('Aucun travail lancé depuis ce tableau de bord.')).toBeTruthy()
    await submit('1. Baseline')
    expect(await screen.findByText('En cours')).toBeTruthy()
    expect(screen.getByText('varia baseline')).toBeTruthy()
    expect(screen.getByText("Aucune sortie pour l'instant.")).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Lancer la baseline' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await finish(0)
    expect(await screen.findAllByText('Terminé', {}, { timeout: 4000 })).toBeTruthy()
    expect(screen.getByText('code de sortie 0')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Voir les résultats' }).getAttribute('href')).toBe(
      '#/runs',
    )
    expect(
      (screen.getByRole('button', { name: 'Lancer la baseline' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  }, 15_000)

  it('test rapide borné ; code 1 = problèmes trouvés (le travail est terminé, pas en échec)', async () => {
    output = 'sortie visible\n'
    await open(runner)
    fireEvent.change(
      screen.getAllByLabelText('Nombre maximal de mutations (facultatif)')[0] as Element,
      {
        target: { value: '20' },
      },
    )
    await submit('2. Test rapide')
    expect(await screen.findByText('varia test --quick --max-mutations 20')).toBeTruthy()
    expect(screen.getByText('sortie visible', { exact: false })).toBeTruthy()
    await finish(1)
    expect(
      await screen.findByText(/des problèmes de résilience ont été trouvés/, {}, { timeout: 4000 }),
    ).toBeTruthy()
  }, 15_000)

  it('arrêt confirmé en ligne ; « continuer » abandonne la demande', async () => {
    await open(runner)
    await submit('3. Test complet')
    await screen.findByText('En cours')
    fireEvent.click(screen.getByRole('button', { name: 'Arrêter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }))
    expect(screen.getByRole('button', { name: 'Arrêter' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Arrêter' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: "Confirmer l'arrêt" }))
    })
    expect(killed).toContain(7)
    await finish(null)
    expect(await screen.findByText('Arrêté', {}, { timeout: 4000 })).toBeTruthy()
  }, 15_000)

  it('second lancement pendant un travail : refus clair (409)', async () => {
    await open(runner)
    await submit('3. Test complet')
    await screen.findByText('En cours')
    await submit('1. Baseline')
    expect((await screen.findByRole('alert')).textContent).toContain('déjà en cours')
    await finish(0)
    await screen.findAllByText('Terminé', {}, { timeout: 4000 })
  }, 15_000)

  it('paramètre hors bornes : message d’erreur, aucun travail', async () => {
    await open(runner)
    const before = children.length
    fireEvent.change(
      screen.getAllByLabelText('Durée maximale en secondes (facultative)')[0] as Element,
      {
        target: { value: '3' },
      },
    )
    await submit('2. Test rapide')
    expect((await screen.findByRole('alert')).textContent).toContain('Paramètres invalides')
    expect(children.length).toBe(before)
  })

  it('journal tronqué : seule la fin est montrée, avec avertissement', async () => {
    output = 'x'.repeat(JOB_LIMITS.logTailBytes + 10)
    await open(runner)
    await submit('1. Baseline')
    expect(await screen.findByText(/Début du journal coupé/)).toBeTruthy()
    await finish(2)
    expect(await screen.findByText('Échec', {}, { timeout: 4000 })).toBeTruthy()
  }, 15_000)

  it('API injoignable : message, pas de plantage', async () => {
    failJobs = true
    await open(runner)
    expect((await screen.findByRole('alert')).textContent).toContain('Impossible de joindre')
  })
})
