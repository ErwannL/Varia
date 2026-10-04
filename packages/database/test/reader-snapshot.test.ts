import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openReader, openSnapshot, openWriter } from '../src/index.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'varia-reader-'))
/** Une base WAL fermée proprement, avec une ligne. */
function walDb(dir: string): string {
  const path = join(dir, 'varia.db')
  const w = openWriter(path)
  w.sqlite.exec('CREATE TABLE IF NOT EXISTS probe (n INTEGER)')
  w.sqlite.prepare('INSERT INTO probe (n) VALUES (42)').run()
  w.close()
  return path
}
const count = (o: ReturnType<typeof openReader>) =>
  (o.sqlite.prepare('SELECT n FROM probe').get() as { n: number }).n

describe('openReader : lecture en place, sinon instantané', () => {
  it('dossier inscriptible : lecture en place, aucun instantané', () => {
    const dir = tmp()
    const snaps = tmp()
    const reader = openReader(walDb(dir), snaps)
    expect(count(reader)).toBe(42)
    expect(readdirSync(snaps)).toEqual([])
    reader.close()
  })

  it('SQLITE_CANTOPEN (-shm impossible à créer, comme sur un volume en lecture seule) : instantané lu, base source intacte, nettoyé à la fermeture', () => {
    const dir = tmp()
    const snaps = tmp()
    const path = walDb(dir)
    // Un DOSSIER à la place du fichier `-shm` : la même panne qu'un volume en lecture seule, sans chmod.
    mkdirSync(`${path}-shm`)
    const before = readFileSync(path)
    const reader = openReader(path, snaps)
    expect(count(reader)).toBe(42)
    expect(readdirSync(snaps)).toHaveLength(1)
    expect(readFileSync(path).equals(before)).toBe(true)
    reader.close()
    expect(readdirSync(snaps)).toEqual([])
  })

  it('un journal WAL présent est copié avec la base ; un journal invalide est ignoré par SQLite', () => {
    const dir = tmp()
    const snaps = tmp()
    const path = walDb(dir)
    writeFileSync(`${path}-wal`, Buffer.from('pas un journal wal'))
    mkdirSync(`${path}-shm`)
    const reader = openReader(path, snaps)
    const copied = join(snaps, readdirSync(snaps)[0] ?? '', 'varia.db-wal')
    expect(existsSync(copied)).toBe(true)
    expect(count(reader)).toBe(42)
    reader.close()
  })

  it('toute autre erreur est relancée (fichier qui n’est pas une base), sans instantané', () => {
    const dir = tmp()
    const snaps = tmp()
    const path = join(dir, 'varia.db')
    writeFileSync(path, 'ceci n’est pas une base SQLite, loin de là'.repeat(20))
    expect(() => openReader(path, snaps)).toThrow(/not a database/i)
    expect(readdirSync(snaps)).toEqual([])
  })
})

describe('openSnapshot : copie jetable', () => {
  it('base sans journal WAL : copiée seule ; fermeture ⇒ dossier temporaire supprimé', () => {
    const dir = tmp()
    const snaps = tmp()
    const path = walDb(dir)
    expect(existsSync(`${path}-wal`)).toBe(false)
    const snap = openSnapshot(path, snaps)
    const copied = readdirSync(join(snaps, readdirSync(snaps)[0] ?? ''))
    expect(copied).not.toContain('varia.db-wal')
    expect(count(snap)).toBe(42)
    snap.close()
    expect(readdirSync(snaps)).toEqual([])
  })
})
