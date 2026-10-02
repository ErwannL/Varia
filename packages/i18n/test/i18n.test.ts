import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { configIssue, issueTitle, messages, orqeaUrl, resolveLocale, t } from '../src/index.js'

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
      const raw = readFileSync(`packages/i18n/src/locales/${file}.json`, 'utf8').toLowerCase()
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

describe('titres d’issues traduits au rendu', () => {
  const base = { target: 'src/a.js#f', errorName: 'TypeError', message: 'x is <str>' }
  it('par type, en fr et en', () => {
    expect(issueTitle('en', { ...base, kind: 'PROCESS_EXIT', title: 'stocké' })).toBe(
      'src/a.js#f: abnormal process exit',
    )
    expect(issueTitle('fr', { ...base, kind: 'TIMEOUT', title: '' })).toBe('src/a.js#f : timeout')
    expect(issueTitle('en', { ...base, kind: 'ERROR', title: '' })).toBe(
      'src/a.js#f: TypeError — x is <str>',
    )
    expect(
      issueTitle('en', {
        ...base,
        kind: 'SUSPICIOUS_ACCEPT',
        errorName: 'ECHO',
        message: 'arg0.age',
        title: '',
      }),
    ).toBe('src/a.js#f: suspicious accept (ECHO) on arg0.age')
  })
  it('acceptation suspecte sans raison enregistrée : raison lue dans le titre ; champs absents', () => {
    expect(
      issueTitle('fr', {
        target: 't',
        errorName: null,
        message: null,
        kind: 'SUSPICIOUS_ACCEPT',
        title: 'x (HINT_VIOLATION) y',
      }),
    ).toBe('t : acceptation suspecte (HINT_VIOLATION) sur ')
    expect(
      issueTitle('fr', {
        target: 't',
        errorName: null,
        message: null,
        kind: 'SUSPICIOUS_ACCEPT',
        title: 'sans raison',
      }),
    ).toBe('t : acceptation suspecte () sur ')
    expect(issueTitle('en', { target: 't', kind: 'ERROR', title: '' })).toBe('t:  — ')
  })
  it('type inconnu : titre d’origine', () => {
    expect(issueTitle('en', { ...base, kind: 'OTHER', title: 'brut' })).toBe('brut')
  })
})

describe('détails d’erreur de configuration (A-06)', () => {
  it('code connu traduit, détail inconnu rendu tel quel', () => {
    expect(configIssue('fr', 'mutations.combine : UNSUPPORTED_COMBINE')).toMatch(
      /^mutations\.combine : non supporté : les combinaisons/,
    )
    expect(configIssue('en', 'mutations.combine : UNSUPPORTED_COMBINE')).toMatch(/not supported/)
    expect(configIssue('fr', 'version : Invalid input')).toBe('version : Invalid input')
    expect(configIssue('fr', 'x : UNKNOWN_CODE')).toBe('x : UNKNOWN_CODE')
    expect(configIssue('fr', 'texte libre')).toBe('texte libre')
  })
})
