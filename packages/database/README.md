# @varia/database

Base SQLite locale (`better-sqlite3`, WAL) et schéma **Drizzle** (CDC §24, partie B).

- `migrations/` — migrations SQL versionnées, appliquées par `migrate()` (testées).
- `src/schema.ts` — tables Drizzle (miroir exact des migrations, vérifié par un test).
- `src/open.ts` — `openWriter` (orchestrateur, **écrivaine unique**), `openReader` (lecture seule :
  API, dashboard, rapports), `checkDatabase`.
- `src/store.ts` — `Writer` (écritures idempotentes) et `Reader` (requêtes).
- `test/` — tests.

Les valeurs stockées sont déjà redigées par la sonde (`redaction.store_raw_values: false`) ; les
sorties brutes du runner ne sont jamais stockées.
