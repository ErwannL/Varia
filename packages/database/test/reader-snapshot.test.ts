import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openReader, openSnapshot, openWriter, type Opened } from '../src/index.js'

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
const count = (o: Opened) => (o.sqlite.prepare('SELECT n FROM probe').get() as { n: number }).n

/**
 * La panne réelle (volume en lecture seule : `-shm` impossible à créer) dépend de la plateforme et du
 * système de fichiers ; on l'INJECTE. Vérifiée en conteneur avec un volume `:ro` (docs/notes/conteneur.md).
 */
const cantOpen = (code: string) =>
  Object.assign(new Error('unable to open database file'), { code })
/** Ouverture qui échoue d'emblée. */
const failsAtOpen = (code: string) => () => {
  throw cantOpen(code)
}
/** Ouverture qui réussit puis échoue à la PREMIÈRE lecture (le cas d'un volume en lecture seule). */
function failsAtFirstRead(code: string, closed: { n: number }) {
  return (): Opened =>
    ({
      sqlite: {
        prepare: () => ({
          get: () => {
            throw cantOpen(code)
          },
        }),
      },
      close: () => {
        closed.n += 1
      },
    }) as unknown as Opened
}

describe('openReader : lecture en place, sinon instantané', () => {
  it('lecture possible en place : aucun instantané', () => {
    const snaps = tmp()
    const reader = openReader(walDb(tmp()), snaps)
    expect(count(reader)).toBe(42)
    expect(readdirSync(snaps)).toEqual([])
    reader.close()
  })

  it('échec à l’OUVERTURE (SQLITE_CANTOPEN) : instantané lu, base source intacte, nettoyé à la fermeture', () => {
    const snaps = tmp()
    const path = walDb(tmp())
    const before = readFileSync(path)
    const reader = openReader(path, snaps, failsAtOpen('SQLITE_CANTOPEN'))
    expect(count(reader)).toBe(42)
    expect(readdirSync(snaps)).toHaveLength(1)
    expect(readFileSync(path).equals(before)).toBe(true)
    reader.close()
    expect(readdirSync(snaps)).toEqual([])
  })

  it('échec à la PREMIÈRE LECTURE (code étendu) : la connexion échouée est fermée, puis instantané', () => {
    const snaps = tmp()
    const closed = { n: 0 }
    const reader = openReader(
      walDb(tmp()),
      snaps,
      failsAtFirstRead('SQLITE_CANTOPEN_ISDIR', closed),
    )
    expect(closed.n).toBe(1)
    expect(count(reader)).toBe(42)
    reader.close()
    expect(readdirSync(snaps)).toEqual([])
  })

  it('un journal WAL présent est copié avec la base ; un journal invalide est ignoré par SQLite', () => {
    const snaps = tmp()
    const path = walDb(tmp())
    writeFileSync(`${path}-wal`, Buffer.from('pas un journal wal'))
    const reader = openReader(path, snaps, failsAtOpen('SQLITE_CANTOPEN'))
    const copied = join(snaps, readdirSync(snaps)[0] ?? '', 'varia.db-wal')
    expect(existsSync(copied)).toBe(true)
    expect(count(reader)).toBe(42)
    reader.close()
  })

  it('toute autre erreur est relancée (fichier qui n’est pas une base), sans instantané', () => {
    const snaps = tmp()
    const path = join(tmp(), 'varia.db')
    writeFileSync(path, 'ceci n’est pas une base SQLite, loin de là'.repeat(20))
    expect(() => openReader(path, snaps)).toThrow(/not a database/i)
    expect(readdirSync(snaps)).toEqual([])
  })

  it('une erreur sans code est relancée telle quelle', () => {
    const snaps = tmp()
    const boom = new Error('boum')
    expect(() =>
      openReader(walDb(tmp()), snaps, () => {
        throw boom
      }),
    ).toThrow(boom)
    expect(readdirSync(snaps)).toEqual([])
  })
})

describe('openSnapshot : copie jetable', () => {
  it('base sans journal WAL : copiée seule ; fermeture ⇒ dossier temporaire supprimé', () => {
    const snaps = tmp()
    const path = walDb(tmp())
    expect(existsSync(`${path}-wal`)).toBe(false)
    const snap = openSnapshot(path, snaps)
    const copied = readdirSync(join(snaps, readdirSync(snaps)[0] ?? ''))
    expect(copied).not.toContain('varia.db-wal')
    expect(count(snap)).toBe(42)
    snap.close()
    expect(readdirSync(snaps)).toEqual([])
  })
})
