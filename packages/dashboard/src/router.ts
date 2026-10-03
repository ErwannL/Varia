import { useEffect, useState } from 'react'

export interface Route {
  path: string[]
  query: URLSearchParams
}

/** Routeur par fragment (`#/runs/r_1/issues?severity=HIGH`) : filtres dans l'URL (CDC §26). */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/'
  const [p = '/', q = ''] = raw.split('?')
  return {
    path: p.split('/').filter(Boolean).map(decodeURIComponent),
    query: new URLSearchParams(q),
  }
}

export function href(path: string[], query: Record<string, string | undefined> = {}): string {
  const qs = new URLSearchParams(
    Object.entries(query).filter((e): e is [string, string] => e[1] !== undefined),
  ).toString()
  return `#/${path.map(encodeURIComponent).join('/')}${qs === '' ? '' : `?${qs}`}`
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

/** Vrai si l'application est affichée dans une `<iframe>` (ex. intégrée à Orqea). */
export function inIframe(w: Window = window): boolean {
  try {
    return w.self !== w.top
  } catch {
    return true
  }
}

/** Page courante lue dans l'URL (`?page=`, à partir de 1) : la pagination est partageable (E-07). */
export function usePaging(limit: number): {
  limit: number
  offset: number
  go(offset: number): void
} {
  const r = parseHash(window.location.hash)
  const page = Math.max(1, Math.floor(Number(r.query.get('page'))) || 1)
  return {
    limit,
    offset: (page - 1) * limit,
    go(offset) {
      const query = Object.fromEntries(r.query)
      window.location.hash = href(r.path, { ...query, page: String(offset / limit + 1) })
    },
  }
}
