-- Migration 0003 : cache de résultats opt-in (CDC §30), clé = empreinte complète.
CREATE TABLE result_cache (
  key TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);
