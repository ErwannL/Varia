import { t, type Locale, type MessageKey } from '@varia/i18n'
import { createInterface } from 'node:readline/promises'

/** Sorties du CLI (injectables pour les tests). Aucun texte en dur : tout passe par les clés i18n. */
export interface Io {
  out(line: string): void
  err(line: string): void
  /** Question interactive (`oracle suggest`) ; absente hors terminal : rien n'est décidé ni écrit. */
  ask?(question: string): Promise<string>
}

/** Question posée sur le terminal (composant testé, aucune boîte de dialogue native). */
export function terminalAsk(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): (question: string) => Promise<string> {
  return async (question) => {
    const rl = createInterface({ input, output })
    try {
      return await rl.question(`${question} `)
    } finally {
      rl.close()
    }
  }
}

export const processIo: Io = {
  out: (l) => process.stdout.write(l + '\n'),
  err: (l) => process.stderr.write(l + '\n'),
  ...(process.stdin.isTTY === true ? { ask: terminalAsk(process.stdin, process.stderr) } : {}),
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
