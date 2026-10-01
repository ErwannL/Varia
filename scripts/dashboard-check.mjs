// Vérification du dashboard dans un VRAI navigateur (Chromium sans interface) : captures, signature
// avec et sans iframe, prefers-reduced-motion émulé, cibles tactiles, aucune requête externe.
// Usage : node scripts/dashboard-check.mjs <url-du-dashboard> <dossier-de-sortie>
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const base = (process.argv[2] ?? 'http://127.0.0.1:4321').replace(/\/$/, '')
const out = process.argv[3] ?? 'reports/assets'
mkdirSync(out, { recursive: true })
const origin = new URL(base).origin
const health = await (await fetch(`${base}/health`)).json()
const orqea = new URL(health.orqeaUrl).origin
// Les protections « Local Network Access » de Chromium bloquent une page hôte non locale qui embarque
// une app sur 127.0.0.1 (voir docs/INTEGRATION.md) : désactivées ICI pour tester le rendu en iframe.
const browser = await chromium.launch({
  executablePath:
    process.env.VARIA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessForNavigations,LocalNetworkAccessChecks',
  ],
})
const results = { externalRequests: [], consoleErrors: [], checks: {} }

async function newPage(opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ...opts })
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.origin !== origin && u.protocol !== 'data:' && u.origin !== orqea)
      results.externalRequests.push(r.url())
  })
  page.on('console', (m) => m.type() === 'error' && results.consoleErrors.push(m.text()))
  return page
}

const runs = await (await fetch(`${base}/api/v1/runs?limit=1`)).json()
const runId = runs.items[0]?.id
const issues = await (await fetch(`${base}/api/v1/runs/${runId}/issues?limit=5`)).json()
const issueId = issues.items[0]?.id
const mutId = issues.items[0]?.mutationIds[0]

for (const [name, hash, theme] of [
  ['overview-light', `#/runs/${runId}`, 'light'],
  ['overview-dark', `#/runs/${runId}`, 'dark'],
  ['issues', `#/runs/${runId}/issues`, 'light'],
  ['issue-detail', `#/issues/${issueId}?run=${runId}`, 'light'],
  ['mutation-detail', `#/mutations/${mutId}?run=${runId}`, 'dark'],
  ['not-covered', `#/runs/${runId}/not-covered`, 'light'],
  ['not-found', '#/nope', 'light'],
]) {
  const page = await newPage({ colorScheme: theme })
  await page.addInitScript((t) => window.localStorage.setItem('varia.theme', t), theme)
  await page.goto(`${base}/${hash}`)
  await page.waitForSelector('main h1')
  await page.screenshot({ path: join(out, `dashboard-${name}.png`), fullPage: true })
  if (name === 'overview-light') {
    results.checks.title = await page.title()
    results.checks.byline = await page.textContent('[data-testid=byline]')
    results.checks.backToOrqea = await page.$eval('[data-testid=back-to-orqea]', (a) => ({
      text: a.textContent,
      href: a.getAttribute('href'),
      target: a.getAttribute('target'),
    }))
    results.checks.poweredBy = await page.$eval('[data-testid=powered-by]', (a) => ({
      text: a.textContent,
      href: a.getAttribute('href'),
      target: a.getAttribute('target'),
    }))
    results.checks.author = await page.$eval('[data-testid=author]', (a) => ({
      text: a.textContent,
      href: a.getAttribute('href'),
      target: a.getAttribute('target'),
      rel: a.getAttribute('rel'),
    }))
    results.checks.smallTargets = await page.$$eval(
      'button, .nav a, .back-link, .footer a, .brand',
      (els) =>
        els
          .map((e) => ({ t: e.textContent?.trim(), ...e.getBoundingClientRect().toJSON() }))
          .filter((r) => r.height < 44 || r.width < 44)
          .map((r) => `${r.t} ${Math.round(r.width)}x${Math.round(r.height)}`),
    )
    await page.hover('.brand')
    results.checks.logoOnHover = await page.getAttribute('[data-testid=brand-logo]', 'src')
    await page.screenshot({
      path: join(out, 'dashboard-header-hover.png'),
      clip: { x: 0, y: 0, width: 1280, height: 120 },
    })
  }
  await page.close()
}

// Dans une iframe : page hôte servie sous l'origine Orqea configurée (interceptée, aucun réseau).
// Lancer l'API avec VARIA_ORQEA_URL=http://orqea.localhost pour éviter le blocage « contenu mixte ».
const host = await newPage()
await host.route(`${orqea}/host`, (r) =>
  r.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><title>Orqea</title><body style="margin:0"><iframe src="${base}/#/runs/${runId}" style="width:1280px;height:900px;border:0"></iframe>`,
  }),
)
await host.goto(`${orqea}/host`)
const frame = host.frames().find((f) => f.url().startsWith(base))
await frame.waitForSelector('main h1')
results.checks.iframe = {
  backToOrqeaPresent: (await frame.$('[data-testid=back-to-orqea]')) !== null,
  poweredByPresent: (await frame.$('[data-testid=powered-by]')) !== null,
}
await host.screenshot({ path: join(out, 'dashboard-iframe.png') })
await host.close()

// prefers-reduced-motion émulé : le logo animé du chargeur reste immobile.
const rm = await newPage({ reducedMotion: 'reduce' })
await rm.goto(`${base}/#/runs/${runId}`)
await rm.waitForSelector('main h1')
await rm.hover('.brand')
results.checks.reducedMotion = await rm.evaluate(
  () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
)
await rm.screenshot({
  path: join(out, 'dashboard-reduced-motion.png'),
  clip: { x: 0, y: 0, width: 1280, height: 120 },
})
await rm.close()

await browser.close()
writeFileSync(join(out, 'dashboard-check.json'), JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results, null, 2))
const ok =
  results.externalRequests.length === 0 &&
  results.checks.smallTargets.length === 0 &&
  results.checks.iframe.backToOrqeaPresent === false &&
  results.checks.iframe.poweredByPresent === true
process.exit(ok ? 0 : 1)
