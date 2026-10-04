import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
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

function openReadonly(path: string): Opened {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true })
  sqlite.pragma('busy_timeout = 5000')
  return { sqlite, db: drizzle(sqlite, { schema }), close: () => sqlite.close() }
}

/**
 * Lit une COPIE de la base (et de son journal WAL s'il existe) dans un dossier temporaire. Sert quand
 * le dossier de la base n'est pas inscriptible (volume Docker en lecture seule) : une base WAL exige
 * alors des fichiers `-shm`/`-wal` que SQLite ne peut pas créer. La source n'est jamais modifiée ;
 * l'instantané ne bouge plus, il faut rouvrir pour voir un nouveau run.
 */
export function openSnapshot(path: string, parent: string = tmpdir()): Opened {
  const dir = mkdtempSync(join(parent, 'varia-snapshot-'))
  const copy = join(dir, 'varia.db')
  copyFileSync(path, copy)
  if (existsSync(`${path}-wal`)) copyFileSync(`${path}-wal`, `${copy}-wal`)
  const opened = openReadonly(copy)
  return {
    ...opened,
    close: () => {
      opened.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * Ouvre la base en lecture seule (API, dashboard, rapports) : aucune écriture possible. Si SQLite ne
 * peut pas lire en place (`SQLITE_CANTOPEN`, à l'ouverture ou à la première lecture : dossier en lecture
 * seule), lit un instantané dans `snapshotDir`. Toute autre erreur (base corrompue, pas une base) est relancée.
 */
export function openReader(
  path: string,
  snapshotDir: string = tmpdir(),
  /** Ouverture en place (injectable : la panne dépend de la plateforme, voir `docs/notes/conteneur.md`). */
  open: (path: string) => Opened = openReadonly,
): Opened {
  let first: Opened | null = null
  try {
    first = open(path)
    first.sqlite.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get()
    return first
  } catch (error) {
    first?.close()
    // Codes étendus compris (SQLITE_CANTOPEN_ISDIR…) : tous disent « impossible d'ouvrir en place ».
    if (!String((error as { code?: unknown }).code).startsWith('SQLITE_CANTOPEN')) throw error
    return openSnapshot(path, snapshotDir)
  }
}

/** Vérification d'intégrité (`varia db check`). */
export function checkDatabase(sqlite: Database.Database): string[] {
  return (sqlite.pragma('integrity_check') as { integrity_check: string }[]).map(
    (r) => r.integrity_check,
  )
}

/** Sauvegarde cohérente de la base, même ouverte en WAL (`varia db backup`, CDC §24). */
export async function backupDatabase(
  sqlite: Database.Database,
  destination: string,
): Promise<void> {
  mkdirSync(dirname(destination), { recursive: true })
  await sqlite.backup(destination)
}
