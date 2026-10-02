// @vitest-environment jsdom
// Point d'entrée du dashboard : thème initial (stockage, préférence système) puis montage de l'App.
import { cleanup } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { THEME_KEY } from '../src/components/Brand.js'

const prefersDark = (dark: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: dark && q.includes('dark'), media: q }))

async function boot(withRoot = true) {
  document.body.innerHTML = withRoot ? '<div id="root"></div>' : ''
  vi.resetModules()
  await act(async () => {
    await import('../src/main.js')
  })
  return document.documentElement.dataset['theme']
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
  document.body.innerHTML = ''
})

describe('main.tsx', () => {
  // L'App interroge l'API au montage : réponse vide, aucune requête réseau.
  const noApi = () => vi.stubGlobal('fetch', () => new Promise(() => undefined))

  it('thème stocké prioritaire ; App montée dans #root', async () => {
    noApi()
    prefersDark(true)
    window.localStorage.setItem(THEME_KEY, 'light')
    expect(await boot()).toBe('light')
    expect(document.getElementById('root')?.childElementCount).toBeGreaterThan(0)
  })
  it('sans thème stocké : préférence système (sombre puis clair)', async () => {
    noApi()
    prefersDark(true)
    expect(await boot()).toBe('dark')
    prefersDark(false)
    window.localStorage.setItem(THEME_KEY, 'autre')
    expect(await boot()).toBe('light')
  })
  it('stockage indisponible : préférence système ; sans #root : rien n’est monté', async () => {
    noApi()
    prefersDark(true)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(await boot(false)).toBe('dark')
    expect(document.body.childElementCount).toBe(0)
  })
})
