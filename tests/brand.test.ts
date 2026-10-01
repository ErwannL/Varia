import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const fixed = readFileSync('brand/varia.svg', 'utf8')
const animated = readFileSync('brand/varia-animated.svg', 'utf8')

function brandCheck(root: string): number {
  return (
    spawnSync(process.execPath, ['scripts/brand.mjs', '--check', '--root', root], {
      encoding: 'utf8',
    }).status ?? -1
  )
}

function pngSize(path: string): [number, number] {
  const b = readFileSync(path)
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG')
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

describe('fichiers de marque dérivés', () => {
  it('correspondent à leurs sources SVG', () => {
    expect(brandCheck('.')).toBe(0)
  })

  it('le contrôle détecte un fichier dérivé altéré', () => {
    const root = mkdtempSync(join(tmpdir(), 'varia-brand-'))
    for (const d of ['brand', 'docs/assets', 'packages/dashboard/public']) {
      cpSync(d, join(root, d), { recursive: true })
    }
    writeFileSync(join(root, 'docs/assets/logo.svg'), fixed.replace('#4B32D6', '#000000'))
    expect(brandCheck(root)).toBe(1)
  })

  it.each([16, 32, 180, 192, 512, 1024])('PNG %i px aux bonnes dimensions', (size) => {
    expect(pngSize(`brand/png/varia-${size}.png`)).toEqual([size, size])
  })

  it('image de partage 1200×630', () => {
    expect(pngSize('brand/png/og-image.png')).toEqual([1200, 630])
  })

  it('favicon.ico contient 16, 32 et 48 px', () => {
    const b = readFileSync('brand/favicon.ico')
    expect(b.readUInt16LE(2)).toBe(1)
    const count = b.readUInt16LE(4)
    const sizes = Array.from({ length: count }, (_, i) => b.readUInt8(6 + 16 * i))
    expect(sizes).toEqual([16, 32, 48])
  })
})

describe('logos SVG', () => {
  it.each([
    ['fixe', fixed],
    ['animé', animated],
  ])('logo %s : role="img" et <title>', (_name, svg) => {
    expect(svg).toMatch(/<svg[^>]*role="img"/)
    expect(svg).toMatch(/<title[^>]*>Varia<\/title>/)
  })

  it('animation en CSS seul : aucun script ni gestionnaire', () => {
    expect(animated).not.toMatch(/<script/i)
    expect(animated).not.toMatch(/\son[a-z]+=/i)
    expect(animated).not.toMatch(/<animate/i)
    expect(animated).toMatch(/@keyframes/)
  })

  it('animation coupée sous prefers-reduced-motion pour chaque élément animé', () => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(animated)?.[1] ?? ''
    const animatedSelectors = [...style.matchAll(/(\.[\w-]+)\s*\{[^}]*animation:\s*[\w-]+/g)].map(
      (m) => m[1],
    )
    expect(animatedSelectors.length).toBeGreaterThan(0)
    const reduce = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/.exec(style)
    expect(reduce).not.toBeNull()
    const block = reduce?.[1] ?? ''
    expect(block).toMatch(/animation:\s*none/)
    for (const sel of animatedSelectors) expect(block).toContain(sel ?? '')
  })

  it("la position d'arrêt est le logo fixe (même dessin sans le style)", () => {
    const strip = (svg: string) =>
      svg
        .replace(/<style>[\s\S]*?<\/style>\s*/, '')
        .replace(/ class="[^"]*"/g, '')
        .trim()
    expect(strip(animated)).toBe(strip(fixed))
  })

  it('les keyframes partent de la transformation identité', () => {
    for (const m of animated.matchAll(/@keyframes [\w-]+ \{ 0%, 100% \{ transform: ([^;]+);/g)) {
      expect(['translate(0, 0)', 'rotate(0deg)']).toContain(m[1])
    }
  })
})

describe('signature hors application (prompt §4.2)', () => {
  it('en-tête exact du README.md racine', () => {
    const header = [
      '<p align="center"><img src="docs/assets/logo-animated.svg" width="140" alt="Varia"></p>',
      '',
      '# Varia by Orqea',
      '',
      '> Propulsé par [Orqea](https://orqea.dev) · Développé par [Erwann Laplante](https://github.com/ErwannL)',
    ].join('\n')
    expect(readFileSync('README.md', 'utf8').startsWith(header)).toBe(true)
  })
  it('author et homepage dans package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { author: string; homepage: string }
    expect(pkg.author).toBe('Erwann Laplante (https://github.com/ErwannL)')
    expect(pkg.homepage).toBe('https://orqea.dev')
  })
})
