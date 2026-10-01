-- Migration 0001 : schéma initial (CDC §24). Écrivaine unique : l'orchestrateur.
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root TEXT NOT NULL,
  framework TEXT NOT NULL
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  state TEXT NOT NULL,
  mode TEXT NOT NULL,
  seed INTEGER,
  git_commit TEXT,
  git_branch TEXT,
  varia_version TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  env_hash TEXT NOT NULL,
  plan_path TEXT,
  partial INTEGER NOT NULL DEFAULT 0,
  info TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE config_snapshots (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  config TEXT NOT NULL
);
CREATE TABLE tests (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  test_id TEXT NOT NULL,
  file TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  flaky INTEGER NOT NULL DEFAULT 0,
  flaky_reasons TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (run_id, test_id)
);
CREATE TABLE call_sites (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  call_site_id TEXT NOT NULL,
  test_id TEXT NOT NULL,
  module TEXT NOT NULL,
  export TEXT NOT NULL,
  depth INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  args_fingerprint TEXT NOT NULL,
  args TEXT,
  outcome TEXT NOT NULL,
  non_deterministic INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, call_site_id)
);
CREATE TABLE inputs (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  call_site_id TEXT NOT NULL,
  path TEXT NOT NULL,
  type TEXT NOT NULL,
  format TEXT,
  bounds TEXT,
  mutable INTEGER NOT NULL,
  reason TEXT,
  PRIMARY KEY (run_id, call_site_id, path)
);
CREATE TABLE targets (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  export TEXT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (run_id, module, export)
);
CREATE TABLE mutations (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  call_site_id TEXT NOT NULL,
  test_id TEXT NOT NULL,
  target TEXT NOT NULL,
  path TEXT NOT NULL,
  strategy TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (run_id, id)
);
CREATE TABLE mutation_results (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  subtype TEXT,
  reason TEXT,
  outcome TEXT,
  test_status TEXT,
  duration_ms REAL NOT NULL,
  exit_code INTEGER,
  signal TEXT,
  timed_out INTEGER NOT NULL,
  error TEXT,
  echo_path TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, mutation_id)
);
CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  target TEXT NOT NULL,
  title TEXT NOT NULL,
  error_name TEXT,
  frame TEXT,
  message TEXT,
  first_seen_run TEXT NOT NULL
);
CREATE TABLE issue_occurrences (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  issue_id TEXT NOT NULL REFERENCES issues(id),
  state TEXT NOT NULL,
  count INTEGER NOT NULL,
  mutation_ids TEXT NOT NULL,
  PRIMARY KEY (run_id, issue_id)
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX events_run ON events(run_id, type);
CREATE INDEX results_status ON mutation_results(run_id, status);
