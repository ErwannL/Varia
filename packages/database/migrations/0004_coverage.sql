-- Migration 0004 : couverture de baseline par fichier (CDC §23, §24 `coverage`).
CREATE TABLE coverage (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  lines REAL NOT NULL,
  statements REAL NOT NULL,
  functions REAL NOT NULL,
  branches REAL NOT NULL,
  PRIMARY KEY (run_id, file)
);
