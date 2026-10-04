// @vitest-environment jsdom
import { buildServer } from '@varia/api'
import { messages } from '@varia/i18n'
import { SEED_RUN, SEED_RUN_2, seedDatabase } from '@varia/testkit'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.js'

/**
 * E-08 : pseudo-langue. Chaque valeur de clé française est entourée de ⟦…⟧ ; tout texte visible
 * hors marqueurs doit provenir des DONNÉES de l'API (identifiants, chemins, valeurs) ou d'une courte
 * liste de noms propres non traduisibles. Un libellé codé en dur échoue.
 */
const NON_TRANSLATABLE = new Set(['Varia', 'FR', 'EN', 'undefined'])
const original = { ...messages.fr }
const { dataDir } = seedDatabase(undefined, { second: true })
const { app } = buildServer({ dataDir, env: {}, dashboardDir: '/nonexistent' })
const dataTokens = new Set<string>()
const WORD = /[\p{L}\p{N}_$]+/gu

const collect = (v: unknown): void => {
  if (typeof v === 'string' || typeof v === 'number')
    for (const w of String(v).match(WORD) ?? []) dataTokens.add(w)
  else if (Array.isArray(v)) v.forEach(collect)
  else if (typeof v === 'object' && v !== null)
    for (const [k, x] of Object.entries(v)) {
      collect(k)
      collect(x)
    }
}

beforeAll(() => {
  for (const k of Object.keys(messages.fr) as (keyof typeof messages.fr)[])
    messages.fr[k] = `⟦${original[k]}⟧`
  vi.stubGlobal('fetch', async (url: string) => {
    const r = await app.inject({ url, headers: { 'sec-fetch-site': 'same-origin' } })
    collect(JSON.parse(r.body))
    return new Response(r.body, { status: r.statusCode })
  })
})
afterEach(() => cleanup())
afterAll(async () => {
  Object.assign(messages.fr, original)
  vi.unstubAllGlobals()
  await app.close()
})

/** Texte visible hors marqueurs, mot par mot, qui ne vient ni des données ni de la liste blanche. */
function strayWords(): string[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let text = ''
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode())
    text += `${String(n.nodeValue)}\n`
  // Attributs lus par les technologies d'assistance : aussi du texte « visible ».
  for (const el of document.body.querySelectorAll('[aria-label],[title],[alt],[placeholder]'))
    for (const a of ['aria-label', 'title', 'alt', 'placeholder'])
      text += `${el.getAttribute(a) ?? ''}\n`
  const outside = text.replace(/⟦[^⟧]*⟧/g, ' ')
  return (outside.match(WORD) ?? []).filter(
    (w) => !NON_TRANSLATABLE.has(w) && !dataTokens.has(w) && !/^\d+$/.test(w),
  )
}

const issueId = async () =>
  String(
    (
      (await app.inject({ url: `/api/v1/runs/${SEED_RUN}/issues` })).json() as {
        items: { id: string }[]
      }
    ).items[0]?.id,
  )

describe('E-08 : chaque page rendue en pseudo-langue', () => {
  it.each([
    '',
    '#/runs',
    `#/runs/${SEED_RUN}`,
    `#/runs/${SEED_RUN}/issues`,
    `#/runs/${SEED_RUN}/mutations`,
    `#/runs/${SEED_RUN}/not-covered`,
    `#/runs/${SEED_RUN}/tests`,
    `#/runs/${SEED_RUN}/folders`,
    `#/runs/${SEED_RUN}/folders/tests`,
    `#/runs/${SEED_RUN}/files/${encodeURIComponent('tests/users.test.js')}`,
    `#/runs/${SEED_RUN}/tests/t_1`,
    `#/runs/${SEED_RUN}/call-sites/c_1`,
    `#/runs/${SEED_RUN}/coverage`,
    `#/runs/${SEED_RUN_2}/coverage`,
    `#/runs/${SEED_RUN}/capabilities`,
    `#/runs/${SEED_RUN_2}/capabilities`,
    `#/runs/${SEED_RUN}/plugins`,
    `#/runs/${SEED_RUN}/plugins?phase=plan`,
    `#/runs/${SEED_RUN_2}/plugins`,
    '#/history',
    `#/compare?a=${SEED_RUN}&b=${SEED_RUN_2}`,
    '#/acceptances',
    'ISSUE',
    `#/mutations/m_crash1?run=${SEED_RUN}`,
    `#/mutations/m_echo?run=${SEED_RUN}`,
    '#/nope',
  ])('%s : aucun texte visible hors marqueurs', async (hash) => {
    window.location.hash = hash === 'ISSUE' ? `#/issues/${await issueId()}?run=${SEED_RUN}` : hash
    render(<App locale="fr" />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
      expect(screen.queryByTestId('loader-logo')).toBeNull()
    })
    // La pseudo-langue est bien active (sinon le test serait vide de sens).
    expect(document.body.textContent).toContain('⟦')
    // La page contrôlée est bien celle demandée (sauf la route volontairement inconnue).
    expect(document.getElementById('nf-title') === null).toBe(hash !== '#/nope')
    expect(strayWords()).toEqual([])
  })
  it('le contrôle détecte un libellé codé en dur', async () => {
    window.location.hash = '#/runs'
    render(
      <>
        <App locale="fr" />
        <p>Texte en dur</p>
      </>,
    )
    await waitFor(() => expect(screen.queryByTestId('loader-logo')).toBeNull())
    expect(strayWords()).toEqual(['Texte', 'en', 'dur'])
  })
})

describe('E-08 : aucun texte traduit rangé dans un état ou une constante', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? files(join(dir, e.name))
        : /\.tsx?$/.test(e.name)
          ? [join(dir, e.name)]
          : [],
    )
  it('ni useState(t(…)) ni constante de module initialisée par t(…) / translate(…)', () => {
    const src = join(import.meta.dirname, '..', 'src')
    const offenders = files(src).filter((f) => {
      const code = readFileSync(f, 'utf8')
      return (
        /useState[^(]*\(\s*(\(\)\s*=>\s*)?t\(/.test(code) ||
        /^(export )?const \w+[^=]*=\s*(t|translate)\(/m.test(code)
      )
    })
    expect(offenders).toEqual([])
  })
})
