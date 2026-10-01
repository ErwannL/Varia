import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from './schema.js'

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export type Db = BetterSQLite3Database<typeof schema>

export interface Opened {
  sqlite: Database.Database
  db: Db
  close(): void
}

/** Applique les migrations manquantes, chacune dans une transaction. Renvoie les versions appliquées. */
export function migrate(sqlite: Database.Database, dir = MIGRATIONS_DIR): string[] {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  )
  const done = new Set(
    (sqlite.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map(
      (r) => r.version,
    ),
  )
  const applied: string[] = []
  for (const file of readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()) {
    const version = file.slice(0, 4)
    if (done.has(version)) continue
    const sql = readFileSync(join(dir, file), 'utf8')
    sqlite.transaction(() => {
      sqlite.exec(sql)
      sqlite
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(version, new Date().toISOString())
    })()
    applied.push(version)
  }
  return applied
}

/** Ouvre la base en écriture (orchestrateur, écrivaine unique) : WAL, clés étrangères, migrations. */
export function openWriter(path: string): Opened {
  mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  migrate(sqlite)
  return { sqlite, db: drizzle(sqlite, { schema }), close: () => sqlite.close() }
}

/** Ouvre la base en lecture seule (API, dashboard, rapports) : aucune écriture possible. */
export function openReader(path: string): Opened {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true })
  sqlite.pragma('busy_timeout = 5000')
  return { sqlite, db: drizzle(sqlite, { schema }), close: () => sqlite.close() }
}

/** Vérification d'intégrité (`varia db check`). */
export function checkDatabase(sqlite: Database.Database): string[] {
  return (sqlite.pragma('integrity_check') as { integrity_check: string }[]).map(
    (r) => r.integrity_check,
  )
}
