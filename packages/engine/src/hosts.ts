import { VariaError } from './errors.js'

/** Adresses d'écoute de la boucle locale : les seules permises sans `--allow-remote` (CDC §19.2). */
const LOOPBACK_BIND = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
/** Formes de l'en-tête `Host` désignant la boucle locale (IPv6 entre crochets). */
const LOOPBACK_HEADER = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Vrai si l'adresse d'écoute reste sur la machine (jamais joignable depuis le réseau). */
export const isLoopbackHost = (host: string): boolean => LOOPBACK_BIND.has(host.toLowerCase())

/** Une entrée de `VARIA_ALLOWED_HOSTS` : un nom, avec un port facultatif. */
export interface AllowedHost {
  name: string
  /** `null` : le port d'écoute du serveur. */
  port: number | null
}

const ENTRY = /^(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?$/

/**
 * Lit `VARIA_ALLOWED_HOSTS` (liste séparée par des virgules de `nom` ou `nom:port`). Utile derrière un
 * port publié par un conteneur (`localhost:4322` alors que Varia écoute sur 4321). Une entrée invalide
 * est refusée, jamais ignorée (« accepté = implémenté »).
 */
export function parseAllowedHosts(raw: string | undefined): AllowedHost[] {
  const out: AllowedHost[] = []
  for (const part of (raw ?? '').split(',')) {
    const entry = part.trim().toLowerCase()
    if (entry === '') continue
    const m = ENTRY.exec(entry)
    const port = m?.[2] === undefined ? null : Number(m[2])
    if (m === null || (port !== null && (port < 1 || port > 65535)))
      throw new VariaError('CONFIG_FAILURE', 'VARIA_ALLOWED_HOSTS : entrée invalide', [
        `VARIA_ALLOWED_HOSTS : « ${part.trim()} » n’est pas un hôte (nom ou nom:port)`,
      ])
    out.push({ name: String(m[1]), port })
  }
  return out
}

/**
 * Anti « DNS rebinding » (CDC §25.2) : le nom de l'en-tête `Host` (ou de l'`Origin`) doit être la boucle
 * locale ou une entrée autorisée, et son port celui qui est lié (ou celui de l'entrée). Sans port lié
 * (serveur qui n'écoute pas, tests), seul le nom compte.
 */
export function hostHeaderAllowed(
  name: string,
  port: string | undefined,
  bound: number | null,
  allowed: readonly AllowedHost[],
): boolean {
  const n = name.toLowerCase()
  const p = Number(port)
  const portOk = (expected: number | null) => bound === null || p === (expected ?? bound)
  return (
    (LOOPBACK_HEADER.has(n) && portOk(null)) || allowed.some((e) => e.name === n && portOk(e.port))
  )
}
