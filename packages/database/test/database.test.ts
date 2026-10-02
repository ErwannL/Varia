import Database from 'better-sqlite3'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { copyFileSync, readdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SEED_PROJECT, SEED_RUN, SEED_RUN_2, seedDatabase } from '@varia/testkit'
import {
  MIGRATIONS_DIR,
  backupDatabase,
  checkDatabase,
  migrate,
  openReader,
  openWriter,
  Reader,
  tables,
  Writer,
} from '../src/index.js'

const dbPath = () => join(mkdtempSync(join(tmpdir(), 'varia-db-')), 'varia.db')

function seeded() {
  const path = dbPath()
  const o = openWriter(path)
  const w = new Writer(o.db)
  w.upsertProject({ id: 'p', name: 'demo', root: '/p', framework: 'jest' })
  w.createRun({
    id: 'r1',
    projectId: 'p',
    state: 'CREATED',
    mode: 'normal',
    seed: 42,
    gitCommit: null,
    gitBranch: null,
    variaVersion: '0.1.0',
    configHash: 'c',
    envHash: 'e',
    planPath: null,
    partial: false,
    info: { a: 1 },
  })
  return { path, o, w, r: new Reader(o.db) }
}

describe('migrations', () => {
  it('appliquées une fois, idempotentes', () => {
    const sqlite = new Database(':memory:')
    expect(migrate(sqlite)).toEqual(['0001', '0002', '0003', '0004', '0005'])
    expect(migrate(sqlite)).toEqual([])
  })
  it('montée de version d’une base existante (0001 → 0002), données conservées', () => {
    const dir = mkdtempSync(join(tmpdir(), 'varia-mig-'))
    for (const f of ['0001_init.sql']) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f))
    const sqlite = new Database(':memory:')
    expect(migrate(sqlite, dir)).toEqual(['0001'])
    sqlite
      .prepare("INSERT INTO projects (id, name, root, framework) VALUES ('p', 'n', '/r', 'jest')")
      .run()
    expect(migrate(sqlite)).toEqual(['0002', '0003', '0004', '0005'])
    expect(sqlite.prepare('SELECT name FROM projects').get()).toEqual({ name: 'n' })
  })
  it('0005 : durées de tests et drapeaux ajoutés sans perte (valeurs par défaut)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'varia-mig-'))
    for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => /^000[1-4]_/.test(x)))
      copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f))
    const sqlite = new Database(':memory:')
    migrate(sqlite, dir)
    sqlite.exec(
      "INSERT INTO projects (id, name, root, framework) VALUES ('p', 'n', '/r', 'jest');" +
        "INSERT INTO runs (id, project_id, state, mode, varia_version, config_hash, env_hash, created_at, updated_at) VALUES ('r', 'p', 'COMPLETED', 'normal', '0', 'c', 'e', 'x', 'x');",
    )
    sqlite
      .prepare(
        "INSERT INTO tests (run_id, test_id, file, name, status) VALUES ('r', 't', 'f', 'n', 'passed')",
      )
      .run()
    sqlite
      .prepare(
        "INSERT INTO mutation_results (run_id, mutation_id, status, duration_ms, timed_out, created_at) VALUES ('r', 'm', 'PASSED', 1, 0, 'x')",
      )
      .run()
    expect(migrate(sqlite)).toEqual(['0005'])
    expect(sqlite.prepare('SELECT name, duration_ms FROM tests').get()).toEqual({
      name: 'n',
      duration_ms: null,
    })
    expect(sqlite.prepare('SELECT flags, test_duration_ms FROM mutation_results').get()).toEqual({
      flags: '[]',
      test_duration_ms: null,
    })
  })
  it('le schéma Drizzle correspond exactement aux tables migrées', () => {
    const sqlite = new Database(':memory:')
    migrate(sqlite)
    for (const table of Object.values(tables.ALL_TABLES)) {
      const cfg = getTableConfig(table)
      const cols = (
        sqlite.prepare(`PRAGMA table_info(${cfg.name})`).all() as {
          name: string
          notnull: number
        }[]
      ).map((c) => [c.name, c.notnull === 1 || c.name === 'id'])
      expect(cols.map((c) => c[0]).sort(), cfg.name).toEqual(cfg.columns.map((c) => c.name).sort())
    }
  })
  it('WAL et intégrité', () => {
    const { o } = seeded()
    expect(o.sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(checkDatabase(o.sqlite)).toEqual(['ok'])
  })
})

describe('écrivaine et lectrice', () => {
  it('run créé partiel ; site d’appel sans arguments enregistrés', () => {
    const { w, r } = seeded()
    w.createRun({
      id: 'r2',
      projectId: 'p',
      state: 'CREATED',
      mode: 'quick',
      seed: 1,
      gitCommit: null,
      gitBranch: null,
      variaVersion: '0.1.0',
      configHash: 'c',
      envHash: 'e',
      planPath: null,
      partial: true,
      info: {},
    })
    expect(r.getRun('r2')?.partial).toBe(true)
    expect(r.countRuns()).toBe(2)
    w.saveCallSites('r2', [
      {
        callSiteId: 'c0',
        testId: 't',
        module: 'm',
        export: 'f',
        depth: 0,
        sequence: 0,
        argsFingerprint: 'fp',
        args: null,
        outcome: { kind: 'return' },
        nonDeterministic: false,
      },
    ])
    expect(r.callSites('r2')[0]?.args).toBeNull()
  })
  it('run : création, mise à jour, lecture', () => {
    const { w, r } = seeded()
    w.updateRun('r1', {
      state: 'COMPLETED',
      partial: true,
      info: { b: 2 },
      planPath: '/x',
      seed: 7,
    })
    expect(r.getRun('r1')).toMatchObject({
      state: 'COMPLETED',
      partial: true,
      info: { b: 2 },
      planPath: '/x',
      seed: 7,
    })
    expect(r.latestRun('p')?.id).toBe('r1')
    expect(r.latestRun('p', ['NOPE'])).toBeNull()
    expect(r.getRun('zz')).toBeNull()
    expect(r.countRuns()).toBe(1)
    expect(r.listRuns()).toHaveLength(1)
  })
  it('résultats idempotents (§16.6)', () => {
    const { w, r } = seeded()
    const res = {
      mutationId: 'm1',
      status: 'CRASH',
      subtype: null,
      reason: null,
      outcome: 'throw',
      testStatus: 'failed',
      durationMs: 1,
      exitCode: 1,
      signal: null,
      timedOut: false,
      error: { name: 'TypeError' },
      echoPath: null,
    }
    expect(w.saveResult('r1', res)).toBe(true)
    expect(w.saveResult('r1', { ...res, status: 'HANDLED' })).toBe(false)
    expect(r.results('r1').map((x) => x.status)).toEqual(['CRASH'])
    expect(r.resultIds('r1')).toEqual(new Set(['m1']))
    expect(r.result('r1', 'm1')?.error).toEqual({ name: 'TypeError' })
  })
  it('issues absentes et acceptations en base', () => {
    const { w, r } = seeded()
    w.saveIssues('r1', 'p', [
      {
        fingerprint: 'i5',
        kind: 'TIMEOUT',
        severity: 'CRITICAL',
        target: 't',
        title: 'x',
        errorName: null,
        frame: null,
        message: null,
        mutationIds: ['m'],
      },
    ])
    w.saveAbsentIssues('r1', [{ issueId: 'i5', state: 'FIXED' }])
    expect(r.issues('r1')[0]).toMatchObject({ state: 'FIXED', count: 0, mutationIds: [] })
    w.addAcceptance({
      id: 'a1',
      projectId: 'p',
      function: 'f',
      path: null,
      strategy: null,
      reason: 'r',
      owner: null,
      expires: null,
    })
    expect(r.acceptances('p').map((a) => a.id)).toEqual(['a1'])
    expect(w.deleteAcceptance('a1')).toBe(true)
    expect(w.deleteAcceptance('a1')).toBe(false)
    expect(r.acceptances('p')).toEqual([])
  })
  it('couverture', () => {
    const { w, r } = seeded()
    w.saveCoverage('r1', [
      { file: 'src/a.js', lines: 90, statements: 88, functions: 100, branches: 50 },
    ])
    expect(r.coverage('r1')).toMatchObject([{ file: 'src/a.js', branches: 50 }])
  })
  it('cache de résultats', () => {
    const { w, r } = seeded()
    const res = {
      mutationId: 'm1',
      status: 'CRASH',
      subtype: null,
      reason: null,
      outcome: 'throw',
      testStatus: 'failed',
      durationMs: 1,
      exitCode: 1,
      signal: null,
      timedOut: false,
      error: null,
      echoPath: null,
    }
    expect(r.cachedResult('k')).toBeNull()
    w.cacheResult('k', res)
    expect(r.cachedResult('k')).toEqual(res)
  })
  it('clearPlan retire mutations, résultats et issues du run', () => {
    const { w, r } = seeded()
    w.saveMutations('r1', [
      {
        id: 'm1',
        callSiteId: 'c',
        testId: 't',
        module: 'm',
        export: 'f',
        pathStr: 'arg0',
        strategy: 'null',
      },
    ])
    w.saveResult('r1', {
      mutationId: 'm1',
      status: 'CRASH',
      subtype: null,
      reason: null,
      outcome: null,
      testStatus: null,
      durationMs: 1,
      exitCode: 1,
      signal: null,
      timedOut: false,
      error: null,
      echoPath: null,
    })
    w.saveIssues('r1', 'p', [
      {
        fingerprint: 'i9',
        kind: 'ERROR',
        severity: 'HIGH',
        target: 't',
        title: 'x',
        errorName: null,
        frame: null,
        message: null,
        mutationIds: ['m1'],
      },
    ])
    w.clearPlan('r1')
    expect([r.mutations('r1'), r.results('r1'), r.issues('r1')]).toEqual([[], [], []])
  })
  it('issues : NEW puis UNCHANGED dans un run suivant', () => {
    const { w, r } = seeded()
    const draft = {
      fingerprint: 'i1',
      kind: 'ERROR',
      severity: 'HIGH',
      target: 't',
      title: 'x',
      errorName: 'TypeError',
      frame: null,
      message: 'm',
      mutationIds: ['m1', 'm2'],
    }
    w.saveIssues('r1', 'p', [draft])
    w.createRun({
      id: 'r2',
      projectId: 'p',
      state: 'CREATED',
      mode: 'normal',
      seed: 1,
      gitCommit: null,
      gitBranch: null,
      variaVersion: '0.1.0',
      configHash: 'c',
      envHash: 'e',
      planPath: null,
      partial: false,
      info: {},
    })
    w.saveIssues('r2', 'p', [{ ...draft, mutationIds: ['m1'] }])
    expect(r.issues('r1')[0]).toMatchObject({ state: 'NEW', count: 2 })
    expect(r.issues('r2')[0]).toMatchObject({ state: 'UNCHANGED', count: 1, firstSeenRun: 'r1' })
    expect(r.issueHistory('i1')).toHaveLength(2)
    expect(r.issue('i1')?.title).toBe('x')
  })
  it('tests, call sites, inputs, cibles, mutations, événements, config', () => {
    const { w, r } = seeded()
    w.saveConfig('r1', 'version: 1')
    w.saveTests('r1', [
      {
        testId: 't',
        file: 'a.test.js',
        name: 'a',
        status: 'passed',
        flakyReasons: ['NON_DETERMINISTIC_INPUT'],
      },
    ])
    w.saveCallSites('r1', [
      {
        callSiteId: 'c',
        testId: 't',
        module: 'm',
        export: 'f',
        depth: 0,
        sequence: 0,
        argsFingerprint: 'fp',
        args: [1],
        outcome: { kind: 'return' },
        nonDeterministic: true,
      },
    ])
    w.saveInputs('r1', [
      {
        callSiteId: 'c',
        path: 'arg0',
        type: 'number',
        format: null,
        bounds: { min: 1, max: 1, provenance: 'observed' },
        mutable: true,
        reason: null,
      },
    ])
    w.saveTargets('r1', [{ module: 'm', export: 'g', status: 'NEVER_CALLED' }])
    w.saveMutations('r1', [
      {
        id: 'm1',
        callSiteId: 'c',
        testId: 't',
        module: 'm',
        export: 'f',
        pathStr: 'arg0',
        strategy: 'null',
      },
    ])
    w.event('r1', 'MUTATION_STARTED', { mutationId: 'm1' })
    expect(r.config('r1')).toBe('version: 1')
    expect(r.tests('r1')[0]).toMatchObject({
      flaky: true,
      flakyReasons: ['NON_DETERMINISTIC_INPUT'],
    })
    expect(r.callSites('r1')[0]).toMatchObject({ args: [1], nonDeterministic: true })
    expect(r.inputs('r1')[0]).toMatchObject({ mutable: true, bounds: { provenance: 'observed' } })
    expect(r.targets('r1')[0]?.status).toBe('NEVER_CALLED')
    expect(r.mutations('r1')[0]).toMatchObject({ id: 'm1', pathStr: 'arg0' })
    expect(r.mutation('r1', 'm1')?.['strategy']).toBe('null')
    expect(r.mutation('r1', 'zz')).toBeNull()
    expect(r.runOfMutation('m1')).toBe('r1')
    expect(r.events('r1', 'MUTATION_STARTED')[0]?.data).toEqual({ mutationId: 'm1' })
    expect(r.events('r1')).toHaveLength(1)
  })
  it('la lectrice ne peut pas écrire', () => {
    const { path, o } = seeded()
    o.close()
    const ro = openReader(path)
    expect(() => new Writer(ro.db).event('r1', 'X')).toThrow(/readonly/i)
    ro.close()
  })
})

describe('rétention et sauvegarde (B-03, CDC §24)', () => {
  it('prune : garde les N runs récents ; issues et acceptations conservées ; aucun orphelin', () => {
    const { dbPath } = seedDatabase(undefined, { second: true })
    const o = openWriter(dbPath)
    const w = new Writer(o.db)
    w.addAcceptance({
      id: 'a_1',
      projectId: SEED_PROJECT,
      function: 'f',
      path: null,
      strategy: null,
      reason: 'r',
      owner: null,
      expires: null,
    })
    w.event(SEED_RUN, 'X')
    const issuesBefore = o.sqlite.prepare('SELECT COUNT(*) AS n FROM issues').get()
    expect(w.prune(SEED_PROJECT, 1)).toEqual([SEED_RUN])
    const r = new Reader(o.db)
    expect(r.listRuns().map((x) => x.id)).toEqual([SEED_RUN_2])
    expect(o.sqlite.prepare('SELECT COUNT(*) AS n FROM issues').get()).toEqual(issuesBefore)
    expect(r.acceptances(SEED_PROJECT).map((a) => a.id)).toEqual(['a_1'])
    for (const table of [
      'config_snapshots',
      'tests',
      'call_sites',
      'inputs',
      'targets',
      'mutations',
      'mutation_results',
      'issue_occurrences',
      'events',
      'coverage',
    ])
      expect(
        o.sqlite
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE run_id NOT IN (SELECT id FROM runs)`)
          .get(),
        table,
      ).toEqual({ n: 0 })
    expect(w.prune(SEED_PROJECT, 5)).toEqual([])
    expect(w.prune('autre', 0)).toEqual([])
    expect(checkDatabase(o.sqlite)).toEqual(['ok'])
    o.close()
  })
  it('sauvegarde cohérente, relisible', async () => {
    const { dbPath } = seedDatabase()
    const o = openWriter(dbPath)
    const dest = join(mkdtempSync(join(tmpdir(), 'varia-bak-')), 'sub', 'backup.db')
    await backupDatabase(o.sqlite, dest)
    o.close()
    const copy = openReader(dest)
    expect(new Reader(copy.db).listRuns().map((x) => x.id)).toEqual([SEED_RUN])
    copy.close()
  })
})
