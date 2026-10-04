import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDataPath, VariaError } from '../src/index.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'varia-datapath-'))
const withDb = (dir: string) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'varia.db'), '')
}
const failure = (path: string): VariaError => {
  try {
    resolveDataPath(path)
  } catch (e) {
    return e as VariaError
  }
  throw new Error('aucune erreur')
}

describe('resolveDataPath', () => {
  it('un dossier qui contient varia.db est pris tel quel', () => {
    const d = tmp()
    withDb(d)
    expect(resolveDataPath(d)).toBe(d)
  })
  it('une racine de données avec UN seul projet : le dossier de ce projet', () => {
    const d = tmp()
    withDb(join(d, 'projects', 'frontend-abc123'))
    mkdirSync(join(d, 'projects', 'sans-base'), { recursive: true })
    expect(resolveDataPath(d)).toBe(join(d, 'projects', 'frontend-abc123'))
  })
  it('plusieurs projets : erreur de configuration qui les liste, sans deviner', () => {
    const d = tmp()
    withDb(join(d, 'projects', 'b-2'))
    withDb(join(d, 'projects', 'a-1'))
    const e = failure(d)
    expect(e.kind).toBe('CONFIG_FAILURE')
    expect(e.details.map((l) => l.includes('a-1') || l.includes('b-2'))).toEqual([true, true])
    expect(e.details[0]).toContain('a-1')
  })
  it('aucune base (dossier vide, ou projets sans base) : erreur qui dit de lancer d’abord varia', () => {
    const d = tmp()
    expect(failure(d).details[0]).toContain('aucun varia.db')
    mkdirSync(join(d, 'projects', 'vide'), { recursive: true })
    expect(failure(d).details[0]).toContain('aucun varia.db')
  })
})
