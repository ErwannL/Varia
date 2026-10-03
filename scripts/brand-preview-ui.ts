// Captures réelles (Chromium sans interface) du logo animé au survol de l'en-tête, du chargeur et du
// rapport HTML (E-06), dans brand/previews/. Usage : npm run build && npx tsx scripts/brand-preview-ui.ts
import { buildReport, toHtml } from '../packages/reporters/src/index.js'
import { openReader, Reader } from '../packages/database/src/index.js'
import { startServer } from '../packages/api/src/index.js'
import { SEED_RUN, seedDatabase } from '../packages/testkit/src/index.js'
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const out = resolve('brand/previews')
mkdirSync(out, { recursive: true })
const seed = seedDatabase()
const server = await startServer({
  dataDir: seed.dataDir,
  port: 0,
  env: {},
  dashboardDir: resolve('packages/dashboard/dist'),
})
const browser = await chromium.launch({
  executablePath: process.env['VARIA_CHROMIUM'] ?? '/opt/pw-browsers/chromium',
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  // Chargeur : la première réponse de l'API est retenue le temps de la capture.
  let release: () => void = () => undefined
  const held = new Promise<void>((r) => (release = r))
  await page.route('**/api/v1/runs**', async (route) => {
    await held
    await route.continue()
  })
  await page.goto(`${server.url}/#/runs`)
  await page.getByTestId('loader-logo').waitFor()
  await page.waitForTimeout(400)
  await page.screenshot({
    path: resolve(out, 'loader.png'),
    clip: { x: 0, y: 0, width: 1280, height: 400 },
  })
  release()
  // Survol de l'en-tête : le logo fixe devient le logo animé.
  await page.getByTestId('brand-logo').hover()
  await page.waitForTimeout(600)
  await page.screenshot({
    path: resolve(out, 'header-hover.png'),
    clip: { x: 0, y: 0, width: 1280, height: 120 },
  })
  // Rapport HTML autonome (données de démonstration).
  const o = openReader(seed.dbPath)
  const html = toHtml(buildReport(new Reader(o.db), SEED_RUN), 'fr', 'https://orqea.example')
  o.close()
  // Page vierge : la politique de sécurité du tableau de bord ne doit pas s'appliquer au rapport.
  const blank = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await blank.setContent(html)
  await blank.screenshot({ path: resolve(out, 'report-html.png'), fullPage: false })
  console.log('captures : brand/previews/{loader,header-hover,report-html}.png')
} finally {
  await browser.close()
  await server.close()
}
