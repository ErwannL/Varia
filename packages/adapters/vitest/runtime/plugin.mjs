// @ts-check
// Plugin Vite temporaire (CDC §10.0, J2) : réécrit les modules `targets.include` avant toute autre
// transformation. Jamais écrit dans le projet : injecté par le lanceur via l'API de Vitest.
import path from 'node:path'
import { rewriteExports } from './rewrite.mjs'

/**
 * @param {{ root: string, include: string[], exclude: string[] }} o expressions régulières (sources)
 * @returns {import('vite').Plugin}
 */
export function variaPlugin(o) {
  const include = o.include.map((x) => new RegExp(x))
  const exclude = o.exclude.map((x) => new RegExp(x))
  return {
    name: 'varia-probe',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0] ?? id
      if (!/\.[cm]?[jt]sx?$/.test(file) || file.includes('/node_modules/')) return null
      const rel = path.relative(o.root, file).split(path.sep).join('/')
      if (
        rel.startsWith('..') ||
        !include.some((r) => r.test(rel)) ||
        exclude.some((r) => r.test(rel))
      )
        return null
      const out = rewriteExports(code, file, rel)
      return out === null ? null : { code: out.code, map: out.map }
    },
  }
}
