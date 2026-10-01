// Régénère les fichiers de marque dérivés à partir des SVG sources de brand/.
// Usage : node scripts/brand.mjs [--check] [--root <dossier>]
//   --check : ne réécrit rien, échoue (code 1) si un fichier dérivé diffère de sa source.
import { Resvg } from '@resvg/resvg-js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const check = args.includes('--check')
const rootIdx = args.indexOf('--root')
const root = resolve(rootIdx >= 0 ? args[rootIdx + 1] : '.')

export const RASTER_SIZES = [16, 32, 48, 180, 192, 512, 1024]
const ICO_SIZES = [16, 32, 48]

function render(svg, width) {
  return Buffer.from(
    new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } })
      .render()
      .asPng(),
  )
}

function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

const read = (p) => readFileSync(join(root, p))
const fixed = read('brand/varia.svg')
const animated = read('brand/varia-animated.svg')
const og = read('brand/og-image.svg')

const outputs = new Map()
for (const size of RASTER_SIZES) outputs.set(`brand/png/varia-${size}.png`, render(fixed, size))
outputs.set(
  'brand/favicon.ico',
  ico(ICO_SIZES.map((size) => ({ size, data: outputs.get(`brand/png/varia-${size}.png`) }))),
)
outputs.set('brand/png/og-image.png', render(og, 1200))
outputs.set('docs/assets/logo.svg', fixed)
outputs.set('docs/assets/logo-animated.svg', animated)
outputs.set('packages/dashboard/public/varia.svg', fixed)
outputs.set('packages/dashboard/public/varia-animated.svg', animated)
outputs.set('packages/dashboard/public/favicon.ico', outputs.get('brand/favicon.ico'))
outputs.set('packages/dashboard/public/og-image.png', outputs.get('brand/png/og-image.png'))
outputs.set(
  'packages/dashboard/public/apple-touch-icon.png',
  outputs.get('brand/png/varia-180.png'),
)

const stale = []
for (const [rel, data] of outputs) {
  const path = join(root, rel)
  const same = existsSync(path) && readFileSync(path).equals(data)
  if (same) continue
  if (check) {
    stale.push(rel)
  } else {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, data)
  }
}
if (check && stale.length > 0) {
  console.error('Fichiers de marque périmés (lancer `npm run brand`) :\n' + stale.join('\n'))
  process.exit(1)
}
console.log(
  check ? `brand --check OK (${outputs.size} fichiers)` : `brand: ${outputs.size} fichiers à jour`,
)
