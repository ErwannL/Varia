import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Schéma Drizzle : miroir exact de migrations/*.sql (vérifié par test/database.test.ts).

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  root: text('root').notNull(),
  framework: text('framework').notNull(),
})

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  state: text('state').notNull(),
  mode: text('mode').notNull(),
  seed: integer('seed'),
  gitCommit: text('git_commit'),
  gitBranch: text('git_branch'),
  variaVersion: text('varia_version').notNull(),
  configHash: text('config_hash').notNull(),
  envHash: text('env_hash').notNull(),
  planPath: text('plan_path'),
  partial: integer('partial').notNull().default(0),
  info: text('info').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const configSnapshots = sqliteTable('config_snapshots', {
  runId: text('run_id').primaryKey(),
  config: text('config').notNull(),
})

export const tests = sqliteTable(
  'tests',
  {
    runId: text('run_id').notNull(),
    testId: text('test_id').notNull(),
    file: text('file').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    flaky: integer('flaky').notNull().default(0),
    flakyReasons: text('flaky_reasons').notNull().default('[]'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.runId, t.testId] }) }),
)

export const callSites = sqliteTable(
  'call_sites',
  {
    runId: text('run_id').notNull(),
    callSiteId: text('call_site_id').notNull(),
    testId: text('test_id').notNull(),
    module: text('module').notNull(),
    export: text('export').notNull(),
    depth: integer('depth').notNull(),
    sequence: integer('sequence').notNull(),
    argsFingerprint: text('args_fingerprint').notNull(),
    args: text('args'),
    outcome: text('outcome').notNull(),
    nonDeterministic: integer('non_deterministic').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.runId, t.callSiteId] }) }),
)

export const inputs = sqliteTable(
  'inputs',
  {
    runId: text('run_id').notNull(),
    callSiteId: text('call_site_id').notNull(),
    path: text('path').notNull(),
    type: text('type').notNull(),
    format: text('format'),
    bounds: text('bounds'),
    mutable: integer('mutable').notNull(),
    reason: text('reason'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.runId, t.callSiteId, t.path] }) }),
)

export const targets = sqliteTable(
  'targets',
  {
    runId: text('run_id').notNull(),
    module: text('module').notNull(),
    export: text('export').notNull(),
    status: text('status').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.runId, t.module, t.export] }) }),
)

export const mutations = sqliteTable(
  'mutations',
  {
    runId: text('run_id').notNull(),
    id: text('id').notNull(),
    callSiteId: text('call_site_id').notNull(),
    testId: text('test_id').notNull(),
    target: text('target').notNull(),
    path: text('path').notNull(),
    strategy: text('strategy').notNull(),
    data: text('data').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.runId, t.id] }) }),
)

export const mutationResults = sqliteTable(
  'mutation_results',
  {
    runId: text('run_id').notNull(),
    mutationId: text('mutation_id').notNull(),
    status: text('status').notNull(),
    subtype: text('subtype'),
    reason: text('reason'),
    outcome: text('outcome'),
    testStatus: text('test_status'),
    durationMs: real('duration_ms').notNull(),
    exitCode: integer('exit_code'),
    signal: text('signal'),
    timedOut: integer('timed_out').notNull(),
    error: text('error'),
    echoPath: text('echo_path'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.runId, t.mutationId] }) }),
)

export const issues = sqliteTable('issues', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  kind: text('kind').notNull(),
  severity: text('severity').notNull(),
  target: text('target').notNull(),
  title: text('title').notNull(),
  errorName: text('error_name'),
  frame: text('frame'),
  message: text('message'),
  firstSeenRun: text('first_seen_run').notNull(),
})

export const issueOccurrences = sqliteTable(
  'issue_occurrences',
  {
    runId: text('run_id').notNull(),
    issueId: text('issue_id').notNull(),
    state: text('state').notNull(),
    count: integer('count').notNull(),
    mutationIds: text('mutation_ids').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.runId, t.issueId] }) }),
)

export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  type: text('type').notNull(),
  at: text('at').notNull(),
  data: text('data').notNull().default('{}'),
})

export const acceptances = sqliteTable('acceptances', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  function: text('function').notNull(),
  path: text('path'),
  strategy: text('strategy'),
  reason: text('reason').notNull(),
  owner: text('owner'),
  expires: text('expires'),
  createdAt: text('created_at').notNull(),
})

export const resultCache = sqliteTable('result_cache', {
  key: text('key').primaryKey(),
  result: text('result').notNull(),
  createdAt: text('created_at').notNull(),
})

export const coverage = sqliteTable(
  'coverage',
  {
    runId: text('run_id').notNull(),
    file: text('file').notNull(),
    lines: real('lines').notNull(),
    statements: real('statements').notNull(),
    functions: real('functions').notNull(),
    branches: real('branches').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.runId, t.file] }) }),
)

export const ALL_TABLES = {
  coverage,
  resultCache,
  acceptances,
  projects,
  runs,
  configSnapshots,
  tests,
  callSites,
  inputs,
  targets,
  mutations,
  mutationResults,
  issues,
  issueOccurrences,
  events,
}
