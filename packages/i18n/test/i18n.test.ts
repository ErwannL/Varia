import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { messages, orqeaUrl, resolveLocale, t } from '../src/index.js'

describe('signature (prompt §4.1)', () => {
  it.each([
    ['byline', 'par Orqea', 'by Orqea'],
    ['poweredBy', 'Propulsé par Orqea', 'Powered by Orqea'],
    ['author', 'Développé par Erwann Laplante', 'Developed by Erwann Laplante'],
    ['backToOrqea', '← Retour sur Orqea', '← Back to Orqea'],
  ] as const)('%s', (key, fr, en) => {
    expect(t('fr', key)).toBe(fr)
    expect(t('en', key)).toBe(en)
  })

  it('bannière CLI', () => {
    expect(t('fr', 'cli.banner', { version: '1.2.3' })).toBe('Varia par Orqea · v1.2.3')
    expect(t('en', 'cli.banner', { version: '1.2.3' })).toBe('Varia by Orqea · v1.2.3')
  })

  it('« nouvel onglet » / « new tab » n’apparaît dans aucun catalogue', () => {
    for (const file of ['fr', 'en']) {
      const raw = readFileSync(`packages/i18n/locales/${file}.json`, 'utf8').toLowerCase()
      expect(raw).not.toContain('nouvel onglet')
      expect(raw).not.toContain('new tab')
    }
  })

  it('fr et en ont les mêmes clés', () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.fr).sort())
  })
})

describe('utilitaires', () => {
  it('resolveLocale', () => {
    expect(resolveLocale('en_US.UTF-8')).toBe('en')
    expect(resolveLocale('fr-FR')).toBe('fr')
    expect(resolveLocale(undefined)).toBe('fr')
  })
  it('orqeaUrl', () => {
    expect(orqeaUrl({})).toBe('https://orqea.dev')
    expect(orqeaUrl({ VARIA_ORQEA_URL: ' ' })).toBe('https://orqea.dev')
    expect(orqeaUrl({ VARIA_ORQEA_URL: 'http://localhost:4000' })).toBe('http://localhost:4000')
  })
  it('paramètre manquant laissé visible', () => {
    expect(t('fr', 'cli.banner')).toBe('Varia par Orqea · v{version}')
  })
})
