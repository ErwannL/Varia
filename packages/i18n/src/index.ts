import en from './locales/en.json' with { type: 'json' }
import fr from './locales/fr.json' with { type: 'json' }

export const LOCALES = ['fr', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export type MessageKey = keyof typeof fr

export const messages: Record<Locale, Record<MessageKey, string>> = { fr, en }

export const DEFAULT_ORQEA_URL = 'https://orqea.dev'
export const AUTHOR_URL = 'https://github.com/ErwannL'

/** Traduit une clé ; `{nom}` est remplacé par `params.nom`. On stocke des clés, on traduit au rendu. */
export function t(locale: Locale, key: MessageKey, params: Record<string, string> = {}): string {
  return messages[locale][key].replace(/\{(\w+)\}/g, (whole, name: string) => params[name] ?? whole)
}

/** Choisit la langue à partir d'une valeur du type `fr_FR.UTF-8` ou `en-US` ; français par défaut. */
export function resolveLocale(value: string | undefined): Locale {
  return value?.toLowerCase().startsWith('en') ? 'en' : 'fr'
}

/** URL d'Orqea lue de l'environnement (`VARIA_ORQEA_URL`), défaut `https://orqea.dev`. */
export function orqeaUrl(env: Record<string, string | undefined>): string {
  const value = env['VARIA_ORQEA_URL']?.trim()
  return value !== undefined && value !== '' ? value : DEFAULT_ORQEA_URL
}
