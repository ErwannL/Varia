// Capture réelle du rendu des logos dans Chromium sans interface (brand/previews/).
// Usage : node scripts/brand-preview.mjs
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'

const fixed = readFileSync('brand/varia.svg', 'utf8')
const animated = readFileSync('brand/varia-animated.svg', 'utf8')
const sizes = [16, 32, 64, 140]
const row = (svg, bg) =>
  `<div style="background:${bg};padding:16px;display:flex;gap:20px;align-items:center">` +
  sizes
    .map(
      (s) =>
        `<div style="width:${s}px;height:${s}px">${svg.replace('<svg ', `<svg style="width:${s}px;height:${s}px" `)}</div>`,
    )
    .join('') +
  '</div>'
const html = `<!doctype html><body style="margin:0">${row(fixed, '#ffffff')}${row(fixed, '#0e0c1d')}${row(animated, '#ffffff')}${row(animated, '#0e0c1d')}<img src="data:image/png;base64,${readFileSync('brand/png/og-image.png').toString('base64')}" width="600"></body>`

mkdirSync('brand/previews', { recursive: true })
const browser = await chromium.launch({
  executablePath:
    process.env.VARIA_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
for (const motion of ['no-preference', 'reduce']) {
  const page = await browser.newPage({
    viewport: { width: 640, height: 1000 },
    reducedMotion: motion,
  })
  await page.setContent(html)
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `brand/previews/logos-${motion}.png`, fullPage: true })
  await page.close()
}
await browser.close()
console.log('aperçus écrits dans brand/previews/')
