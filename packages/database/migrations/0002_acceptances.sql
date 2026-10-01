-- Migration 0002 : acceptations stockées en base (CDC §21, `acceptances.store: db`).
CREATE TABLE acceptances (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  function TEXT NOT NULL,
  path TEXT,
  strategy TEXT,
  reason TEXT NOT NULL,
  owner TEXT,
  expires TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX acceptances_project ON acceptances(project_id);
