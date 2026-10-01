import { t, type Locale, type MessageKey } from '@varia/i18n'

/** Sorties du CLI (injectables pour les tests). Aucun texte en dur : tout passe par les clés i18n. */
export interface Io {
  out(line: string): void
  err(line: string): void
}

export const processIo: Io = {
  out: (l) => process.stdout.write(l + '\n'),
  err: (l) => process.stderr.write(l + '\n'),
}

export interface Printer {
  locale: Locale
  quiet: boolean
  json: boolean
  say(key: MessageKey, params?: Record<string, string | number>): void
  warn(key: MessageKey, params?: Record<string, string | number>): void
  data(value: unknown): void
}

export function printer(io: Io, locale: Locale, quiet: boolean, json: boolean): Printer {
  const fmt = (params: Record<string, string | number> = {}) =>
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  return {
    locale,
    quiet,
    json,
    say: (key, params) => {
      if (!quiet && !json) io.out(t(locale, key, fmt(params)))
    },
    warn: (key, params) => {
      if (!json) io.err(t(locale, key, fmt(params)))
    },
    data: (value) => io.out(JSON.stringify(value, null, 2)),
  }
}
