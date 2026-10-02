// Règles d'architecture (CDC §6) : le cœur ne connaît aucun runner ; aucun cycle entre paquets.
import { readdirSync, readFileSync, statSync } from 'node:fs'
// Chemins POSIX : les comparaisons de préfixes (`packages/adapters/`) valent aussi sous Windows.
import { posix } from 'node:path'

const { join } = posix
import { describe, expect, it } from 'vitest'

const PACKAGES = ['packages', 'packages/adapters']
  .flatMap((root) => readdirSync(root).map((d) => join(root, d)))
  .filter((d) => statSync(d).isDirectory() && d !== 'packages/adapters')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (f === 'node_modules' || f === 'dist') return []
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|cjs|mjs|js)$/.test(f) ? [p] : []
  })
}

const pkgJson = (dir: string) =>
  JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    name: string
    dependencies?: Record<string, string>
  }

describe('architecture', () => {
  it('aucun import de jest/vitest hors packages/adapters/* (sources)', () => {
    const offenders: string[] = []
    for (const dir of PACKAGES.filter((d) => !d.startsWith('packages/adapters/'))) {
      for (const f of files(join(dir, 'src')).concat(
        statSync(dir).isDirectory() && readdirSync(dir).includes('runtime')
          ? files(join(dir, 'runtime'))
          : [],
      )) {
        const src = readFileSync(f, 'utf8')
        if (
          /(from\s+|require\()\s*['"](jest|@jest\/[\w-]+|jest-[\w-]+|vitest|babel-jest|ts-jest)['"]/.test(
            src,
          )
        )
          offenders.push(f)
      }
    }
    expect(offenders).toEqual([])
  })
  it('le cœur, le moteur et l’API ne dépendent d’aucun adapter', () => {
    for (const name of [
      'core',
      'engine',
      'api',
      'database',
      'reporters',
      'config',
      'probe-protocol',
      'probe-runtime',
    ]) {
      const deps = Object.keys(pkgJson(join('packages', name)).dependencies ?? {})
      expect(
        deps.filter((d) => d.startsWith('@varia/adapter')),
        name,
      ).toEqual([])
    }
  })
  it('aucun cycle entre paquets', () => {
    const graph = new Map(
      PACKAGES.map((d) => [
        pkgJson(d).name,
        Object.keys(pkgJson(d).dependencies ?? {}).filter((x) => x.startsWith('@varia/')),
      ]),
    )
    const state = new Map<string, 'visiting' | 'done'>()
    const visit = (n: string, path: string[]): string[] | null => {
      if (state.get(n) === 'visiting') return [...path, n]
      if (state.get(n) === 'done') return null
      state.set(n, 'visiting')
      for (const m of graph.get(n) ?? []) {
        const cycle = visit(m, [...path, n])
        if (cycle) return cycle
      }
      state.set(n, 'done')
      return null
    }
    for (const n of graph.keys()) expect(visit(n, [])).toBeNull()
  })
  it('chaque dépendance @varia/* déclarée existe', () => {
    const names = new Set(PACKAGES.map((d) => pkgJson(d).name))
    for (const d of PACKAGES)
      for (const dep of Object.keys(pkgJson(d).dependencies ?? {}))
        if (dep.startsWith('@varia/')) expect(names.has(dep), `${d} → ${dep}`).toBe(true)
  })
  it('aucun Math.random dans le moteur de mutation', () => {
    for (const f of files('packages/core/src'))
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/Math\.random/)
  })
})
