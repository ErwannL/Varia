// @vitest-environment jsdom
import { buildServer } from '@varia/api'
import { SEED_RUN, SEED_RUN_2, seedDatabase } from '@varia/testkit'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.js'

const { dataDir } = seedDatabase(undefined, { second: true })
const { app } = buildServer({ dataDir, env: {}, dashboardDir: '/nonexistent' })

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const r = await app.inject({ method: 'GET', url })
    return new Response(r.body, {
      status: r.statusCode,
      headers: { 'content-type': 'application/json' },
    })
  })
})
afterAll(async () => {
  vi.unstubAllGlobals()
  await app.close()
})
afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('comparaison et couverture (niveau 2) sur deux runs', () => {
  it('diff : issue disparue listée, choix d’un run dans l’URL', async () => {
    window.location.hash = `#/compare?a=${SEED_RUN}&b=${SEED_RUN_2}`
    render(<App locale="fr" />)
    expect(await screen.findByText('Issues disparues (1)')).toBeTruthy()
    expect(screen.getByText('Nouvelles issues (0)')).toBeTruthy()
    expect(screen.getByText('Inchangées : 2')).toBeTruthy()
    const radios = screen.getAllByRole('radio', { name: SEED_RUN })
    fireEvent.click(radios[1] as HTMLElement)
    expect(window.location.hash).toBe(`#/compare?a=${SEED_RUN}&b=${SEED_RUN}`)
  })
  it('couverture collectée : tableau par fichier', async () => {
    window.location.hash = `#/runs/${SEED_RUN_2}/coverage`
    render(<App locale="en" />)
    expect(await screen.findByText('src/users.js')).toBeTruthy()
    expect(screen.getByText('Collected.')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('91.5 %')).toBeTruthy())
  })
})
