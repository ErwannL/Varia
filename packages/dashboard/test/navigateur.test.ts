import { startServer } from '@varia/api'
import { SEED_RUN, seedDatabase } from '@varia/testkit'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright-core'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * E-09 : cibles tactiles et focus mesurés dans un VRAI navigateur (Chromium sans interface), sur le
 * dashboard construit depuis les sources courantes et servi par la vraie API.
 *
 * Navigateur : `VARIA_CHROMIUM`, sinon `/opt/pw-browsers/chromium`, sinon celui de playwright-core.
 * Absent : le test ÉCHOUE (jamais « OK » sans mesure), sauf si `VARIA_BROWSER=absent` déclare
 * explicitement l'absence ; il vérifie alors qu'aucun navigateur n'est trouvable et l'écrit
 * (E-09 = UNVERIFIED sur cette machine). Voir docs/notes/navigateur.md.
 */
export function findChromium(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [env['VARIA_CHROMIUM'], '/opt/pw-browsers/chromium', chromium.executablePath()]
  return candidates.find((c): c is string => c !== undefined && c !== '' && existsSync(c)) ?? null
}

const executable = findChromium()
const declaredAbsent = process.env['VARIA_BROWSER'] === 'absent'

describe('E-09 : navigateur disponible ou absence déclarée', () => {
  it('un navigateur est trouvé, ou son absence est déclarée ET vérifiée', () => {
    if (declaredAbsent) {
      expect(executable, 'VARIA_BROWSER=absent alors qu’un navigateur existe').toBeNull()
      console.warn('E-09 UNVERIFIED : aucun navigateur sur cette machine (VARIA_BROWSER=absent).')
    } else {
      expect(
        executable,
        'Aucun Chromium : installer `npx playwright-core install chromium` ou déclarer VARIA_BROWSER=absent (E-09 UNVERIFIED).',
      ).not.toBeNull()
    }
  })
})

const CONTROLS =
  'button, [role=radio], .nav a, .brand, .back-link, .crumbs a, .pager button, .copy, input, textarea'

/** Vrai si la mesure peut avoir lieu ; sinon l'absence DOIT avoir été déclarée (rien n'est « OK »). */
const measurable = (): boolean => {
  if (executable === null) expect(declaredAbsent).toBe(true)
  return executable !== null
}

describe('E-09 : mesures dans Chromium', () => {
  let browser: Browser
  let server: { url: string; close(): Promise<void> }
  beforeAll(async () => {
    if (executable === null) return
    const outDir = mkdtempSync(join(tmpdir(), 'varia-dash-build-'))
    await build({
      root: join(import.meta.dirname, '..'),
      configFile: join(import.meta.dirname, '..', 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    })
    const { dataDir } = seedDatabase()
    server = await startServer({ dataDir, env: {}, port: 0, dashboardDir: outDir })
    browser = await chromium.launch({ executablePath: executable as string })
  }, 120_000)
  afterAll(async () => {
    if (executable === null) return
    await browser.close()
    await server.close()
  })

  const open = async (hash: string, width = 1280): Promise<Page> => {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.goto(`${server.url}/${hash}`)
    await page.waitForSelector('main h1')
    await page.waitForFunction(() => document.querySelector('[data-testid=loader-logo]') === null)
    return page
  }

  it.each([
    [`#/runs/${SEED_RUN}`, 1280],
    [`#/runs/${SEED_RUN}/issues`, 1280],
    [`#/runs/${SEED_RUN}/mutations`, 390],
    [`#/runs/${SEED_RUN}/folders`, 1280],
    [`#/runs/${SEED_RUN}/tests/t_1`, 390],
    [`#/mutations/m_crash1?run=${SEED_RUN}`, 1280],
    ['#/acceptances', 390],
  ])('%s (%i px) : chaque contrôle mesure au moins 44 × 44 px', async (hash, width) => {
    if (!measurable()) return
    const page = await open(hash, width)
    const boxes = await page.$$eval(CONTROLS, (els) =>
      els
        .map((e) => {
          const r = e.getBoundingClientRect()
          return {
            what: `${e.tagName} ${(e.textContent ?? '').trim().slice(0, 30)}`,
            w: r.width,
            h: r.height,
          }
        })
        .filter((b) => b.w > 0 && b.h > 0),
    )
    expect(boxes.length).toBeGreaterThan(5)
    expect(boxes.filter((b) => b.w < 44 || b.h < 44)).toEqual([])
    await page.close()
  })

  it('focus clavier visible : contour ≥ 2 px et pixels changés sur chaque contrôle atteint', async () => {
    if (!measurable()) return
    const page = await open(`#/runs/${SEED_RUN}`)
    const seen: string[] = []
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      const info = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement
        const s = getComputedStyle(e)
        return {
          what: `${e.tagName} ${(e.textContent ?? '').trim().slice(0, 30)}`,
          style: s.outlineStyle,
          width: parseFloat(s.outlineWidth),
        }
      })
      seen.push(info.what)
      expect(info.style, info.what).not.toBe('none')
      expect(info.width, info.what).toBeGreaterThanOrEqual(2)
    }
    expect(new Set(seen).size).toBeGreaterThan(8)
    // Rendu réel : la zone du lien d'accueil change quand il reçoit le focus.
    const brand = page.locator('.brand')
    const box = (await brand.boundingBox()) as {
      x: number
      y: number
      width: number
      height: number
    }
    const clip = { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 }
    await page.evaluate(() => (document.activeElement as HTMLElement).blur())
    await page.mouse.move(0, 899)
    const before = await page.screenshot({ clip, animations: 'disabled' })
    await page.focus('.skip') // lien d'évitement, puis Tab : lien d'accueil
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.className)).toBe('brand')
    const after = await page.screenshot({ clip, animations: 'disabled' })
    expect(after.equals(before)).toBe(false)
    await page.close()
  })
})
