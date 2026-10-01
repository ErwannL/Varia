import { messages, t as translate, type Locale, type MessageKey } from '@varia/i18n'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export const LOCALE_KEY = 'varia.locale'

interface I18n {
  locale: Locale
  setLocale(l: Locale): void
  t(key: MessageKey, params?: Record<string, string | number>): string
}

const Ctx = createContext<I18n | null>(null)

export function initialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_KEY)
    if (stored === 'fr' || stored === 'en') return stored
  } catch {
    // stockage indisponible
  }
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'fr'
}

/** On garde la LANGUE dans l'état, jamais un texte traduit : la traduction se fait au rendu. */
export function I18nProvider({
  children,
  locale: forced,
}: {
  children: ReactNode
  locale?: Locale
}) {
  const [locale, setLocaleState] = useState<Locale>(forced ?? initialLocale())
  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale(l) {
        setLocaleState(l)
        document.documentElement.lang = l
        try {
          window.localStorage.setItem(LOCALE_KEY, l)
        } catch {
          // stockage indisponible
        }
      },
      t: (key, params = {}) =>
        translate(
          locale,
          key,
          Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
        ),
    }),
    [locale],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const v = useContext(Ctx)
  if (v === null) throw new Error('I18nProvider manquant')
  return v
}

export { messages }
