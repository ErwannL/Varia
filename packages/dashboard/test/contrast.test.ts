import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('packages/dashboard/src/styles.css', 'utf8')
/** CSS aplati (espaces normalisés) : les assertions ne dépendent pas du formatage. */
const flat = css.replace(/\s+/g, ' ')

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  const block = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [
      m[1] ?? '',
      (m[2] ?? '').toLowerCase(),
    ]),
  )
}

/** Luminance relative et ratio de contraste WCAG 2.1. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

const TEXT_PAIRS: [string, string][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['link', 'bg'],
  ['link', 'surface'],
  ['on-accent', 'accent'],
  ...['crash', 'timeout', 'unexpected', 'suspicious', 'handled', 'passed', 'skipped', 'infra'].map(
    (k) => [`${k}-fg`, `${k}-bg`] as [string, string],
  ),
]

describe('contrastes WCAG AA (prompt §4.4)', () => {
  it('référence : noir sur blanc = 21', () =>
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5))
  for (const theme of [':root', "[data-theme='dark']"]) {
    const t = tokens(theme)
    it.each(TEXT_PAIRS)(`${theme} : --%s sur --%s ≥ 4.5`, (fg, bg) => {
      expect(t[fg], fg).toBeDefined()
      expect(t[bg], bg).toBeDefined()
      expect(contrast(t[fg] ?? '', t[bg] ?? '')).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme} : anneau de focus ≥ 3 sur fond et surface`, () => {
      expect(contrast(t['focus'] ?? '', t['bg'] ?? '')).toBeGreaterThanOrEqual(3)
      expect(contrast(t['focus'] ?? '', t['surface'] ?? '')).toBeGreaterThanOrEqual(3)
    })
  }
})

describe('mouvement et cibles', () => {
  it('toute animation coupée sous prefers-reduced-motion', () => {
    expect(flat).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation: none !important; transition: none !important;/,
    )
  })
  it('cibles tactiles ≥ 44 px déclarées', () => {
    expect(flat).toMatch(
      /button, \.nav a, \.seg, \.copy, \.back-link, \.pager button, \.skip \{ min-height: 44px; min-width: 44px; \}/,
    )
  })
  it('focus visible', () =>
    expect(flat).toMatch(/:focus-visible \{ outline: 3px solid var\(--focus\)/))
})
