import { groupIssues, type Classification, type PlannedMutation } from '@varia/core'
import { openWriter, Writer } from '@varia/database'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const SEED_PROJECT = 'p_demo'
export const SEED_RUN = 'r_demo00000001'

const m = (id: string, over: Partial<PlannedMutation>): PlannedMutation => ({
  id,
  callSiteId: 'c_1',
  testId: 't_1',
  testFile: 'tests/users.test.js',
  testName: 'createUser crée un utilisateur valide',
  module: 'src/users.js',
  export: 'createUser',
  depth: 0,
  sequence: 0,
  argsFingerprint: 'fp',
  path: ['0', 'name'],
  pathStr: 'arg0.name',
  strategy: 'type',
  op: 'set',
  original: 'Erwann',
  value: {},
  originalType: 'string',
  mutatedType: 'object',
  ...over,
})

export const SEED_MUTATIONS: PlannedMutation[] = [
  m('m_crash1', {}),
  m('m_crash2', { value: [], mutatedType: 'array' }),
  m('m_handled', { strategy: 'null', value: null, mutatedType: 'null' }),
  m('m_timeout', {
    module: 'src/values.js',
    export: 'repeat',
    pathStr: 'arg1',
    path: ['1'],
    value: null,
    strategy: 'null',
    mutatedType: 'null',
  }),
  m('m_echo', {
    module: 'src/values.js',
    export: 'echoValue',
    pathStr: 'arg0',
    path: ['0'],
    value: '<script>alert(1)</script>',
    strategy: 'type',
    mutatedType: 'string',
    originalType: 'number',
  }),
  m('m_skipped', {
    module: 'src/values.js',
    export: 'echoValue',
    pathStr: 'arg0',
    path: ['0'],
    strategy: 'null',
    value: null,
  }),
  m('m_pending', { strategy: 'empty', value: '' }),
]

const crash = (message: string): Classification => ({
  status: 'CRASH',
  testStatus: 'failed',
  outcome: 'throw',
  error: {
    name: 'TypeError',
    message,
    stack: '    at createUser (/p/src/users.js:14:24)',
    constructorChain: ['TypeError', 'Error'],
  },
})

export const SEED_RESULTS: Record<string, Classification> = {
  m_crash1: crash('name.trim is not a function'),
  m_crash2: crash('name.trim is not a function'),
  m_handled: {
    status: 'HANDLED',
    testStatus: 'failed',
    outcome: 'throw',
    error: {
      name: 'ValidationError',
      message: 'name is required',
      stack: '',
      constructorChain: ['ValidationError', 'Error'],
    },
  },
  m_timeout: { status: 'TIMEOUT', testStatus: null },
  m_echo: {
    status: 'PASSED',
    subtype: 'SUSPICIOUS_ACCEPT',
    reason: 'ECHO',
    echoPath: 'return.received',
    testStatus: 'passed',
    outcome: 'return',
  },
  m_skipped: { status: 'SKIPPED', reason: 'AMBIGUOUS_CALL_SITE', testStatus: 'passed' },
}

/** Crée une base Varia réaliste (un run complet de l'exemple, redigé) dans un dossier temporaire. */
export const SEED_RUN_2 = 'r_demo00000002'

/** `second` : ajoute un run plus récent (une issue disparue, couverture collectée) pour la comparaison. */
export function seedDatabase(
  dataDir = mkdtempSync(join(tmpdir(), 'varia-seed-')),
  o: { second?: boolean } = {},
): { dataDir: string; dbPath: string } {
  const dbPath = join(dataDir, 'varia.db')
  const db = openWriter(dbPath)
  const w = new Writer(db.db)
  w.upsertProject({ id: SEED_PROJECT, name: 'demo', root: '/p', framework: 'jest' })
  const caps = {
    observation: true,
    argumentMutation: true,
    perTestSelection: true,
    asyncTargets: true,
    esm: false,
    cjs: true,
    mocks: false,
    testParameters: true,
    coverage: false,
    isolatedProcess: true,
    parallelSafe: false,
  }
  w.createRun({
    id: SEED_RUN,
    projectId: SEED_PROJECT,
    state: 'COMPLETED',
    mode: 'normal',
    seed: 42,
    gitCommit: 'abc',
    gitBranch: 'main',
    variaVersion: '0.1.0',
    configHash: 'cfg',
    envHash: 'env',
    planPath: null,
    partial: false,
    info: {
      projectName: 'demo',
      projectRoot: '/p',
      adapter: 'jest',
      capabilities: caps,
      depth: 'direct',
      plan: { possible: 20, planned: 7, sampled: true, estimateMs: 4200 },
    },
  })
  w.saveConfig(SEED_RUN, 'version: 1\n')
  w.saveTests(SEED_RUN, [
    {
      testId: 't_1',
      file: 'tests/users.test.js',
      name: 'createUser crée un utilisateur valide',
      status: 'passed',
      flakyReasons: [],
    },
    {
      testId: 't_2',
      file: 'tests/values.test.js',
      name: 'echoValue renvoie un horodatage',
      status: 'passed',
      flakyReasons: ['NON_DETERMINISTIC_INPUT'],
    },
  ])
  w.saveCallSites(SEED_RUN, [
    {
      callSiteId: 'c_1',
      testId: 't_1',
      module: 'src/users.js',
      export: 'createUser',
      depth: 0,
      sequence: 0,
      argsFingerprint: 'fp',
      args: [{ name: 'Erwann', password: { $redacted: true, fingerprint: 'h', type: 'string' } }],
      outcome: { kind: 'return' },
      nonDeterministic: false,
    },
  ])
  w.saveInputs(SEED_RUN, [
    {
      callSiteId: 'c_1',
      path: 'arg0.name',
      type: 'string',
      format: null,
      bounds: null,
      mutable: true,
      reason: null,
    },
    {
      callSiteId: 'c_1',
      path: 'arg0.password',
      type: 'string',
      format: null,
      bounds: null,
      mutable: false,
      reason: 'REDACTED',
    },
  ])
  w.saveTargets(SEED_RUN, [
    { module: 'src/users.js', export: 'createUser', status: 'OBSERVED' },
    { module: 'src/math.js', export: 'helper', status: 'NEVER_CALLED' },
    { module: 'src/text.js', export: 'inner', status: 'TRANSITIVE_ONLY' },
    { module: 'src/errors.js', export: 'ValidationError', status: 'UNSUPPORTED' },
  ])
  w.saveMutations(SEED_RUN, SEED_MUTATIONS)
  for (const [id, c] of Object.entries(SEED_RESULTS)) {
    w.saveResult(SEED_RUN, {
      mutationId: id,
      status: c.status,
      subtype: c.subtype ?? null,
      reason: c.reason ?? null,
      outcome: c.outcome ?? null,
      testStatus: c.testStatus,
      durationMs: 600,
      exitCode: 1,
      signal: null,
      timedOut: c.status === 'TIMEOUT',
      error: c.error ?? null,
      echoPath: c.echoPath ?? null,
    })
  }
  const results = SEED_MUTATIONS.filter((x) => SEED_RESULTS[x.id] !== undefined).map(
    (mutation) => ({ mutation, classification: SEED_RESULTS[mutation.id] as Classification }),
  )
  const drafts = groupIssues(results, '/p')
  w.saveIssues(SEED_RUN, SEED_PROJECT, drafts)
  if (o.second === true) {
    w.createRun({
      id: SEED_RUN_2,
      projectId: SEED_PROJECT,
      state: 'COMPLETED',
      mode: 'normal',
      seed: 42,
      gitCommit: 'def',
      gitBranch: 'main',
      variaVersion: '0.1.0',
      configHash: 'cfg',
      envHash: 'env',
      planPath: null,
      partial: false,
      info: {
        projectName: 'demo',
        projectRoot: '/p',
        adapter: 'jest',
        capabilities: caps,
        depth: 'direct',
        comparedTo: SEED_RUN,
        coverage: 'COLLECTED',
      },
    })
    w.saveMutations(SEED_RUN_2, SEED_MUTATIONS)
    w.saveCoverage(SEED_RUN_2, [
      { file: 'src/users.js', lines: 91.5, statements: 90, functions: 100, branches: 75 },
    ])
    const kept = drafts.filter((d) => d.kind !== 'TIMEOUT')
    w.saveIssues(
      SEED_RUN_2,
      SEED_PROJECT,
      kept.map((d) => ({ ...d, state: 'UNCHANGED' })),
    )
    w.saveAbsentIssues(
      SEED_RUN_2,
      drafts
        .filter((d) => d.kind === 'TIMEOUT')
        .map((d) => ({ issueId: d.fingerprint, state: 'FIXED' })),
    )
  }
  db.close()
  return { dataDir, dbPath }
}
