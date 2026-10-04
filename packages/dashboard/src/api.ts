import { useEffect, useState } from 'react'

export interface Health {
  status: string
  name: string
  version: string
  orqeaUrl: string
  database: boolean
  canRun: boolean
}

export type Loadable<T> =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: T }

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
  return (await res.json()) as T
}

/** Charge une ressource de l'API locale (même origine, aucune requête externe). */
export function useApi<T>(path: string | null): Loadable<T> {
  const [value, setValue] = useState<Loadable<T>>({ state: 'loading' })
  useEffect(() => {
    if (path === null) return
    let alive = true
    setValue({ state: 'loading' })
    getJson<T>(path).then(
      (data) => alive && setValue({ state: 'ready', data }),
      (e: unknown) =>
        alive && setValue({ state: 'error', message: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      alive = false
    }
  }, [path])
  return value
}
