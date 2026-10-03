-- Migration 0006 (J3) : empreinte secondaire des issues et rapprochement (CDC §20.2-20.3, C-01) ;
-- couverture inconnue (istanbul « Unknown ») stockée NULL, jamais 100 (B-07).
ALTER TABLE issues ADD COLUMN module TEXT;
ALTER TABLE issues ADD COLUMN stack_files TEXT;
ALTER TABLE issues ADD COLUMN code_hash TEXT;
ALTER TABLE issue_occurrences ADD COLUMN matched_from TEXT NOT NULL DEFAULT '[]';
CREATE TABLE coverage_0006 (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  lines REAL,
  statements REAL,
  functions REAL,
  branches REAL,
  PRIMARY KEY (run_id, file)
);
INSERT INTO coverage_0006 SELECT run_id, file, lines, statements, functions, branches FROM coverage;
DROP TABLE coverage;
ALTER TABLE coverage_0006 RENAME TO coverage;
