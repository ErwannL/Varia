import { openWriter, Reader, openReader, Writer } from '@varia/database'
import { SEED_PROJECT, SEED_RUN, SEED_RUN_2, seedDatabase } from '@varia/testkit'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Aggregates, buildServer, folderOf } from '../src/index.js'

const noDash = join(mkdtempSync(join(tmpdir(), 'varia-nodash-')), 'absent')
const { dataDir } = seedDatabase(undefined, { second: true })
const { app, aggregates } = buildServer({ dataDir, env: {}, dashboardDir: noDash })
afterAll(() => app.close())
const get = async (url: string) => (await app.inject({ url })).json() as Record<string, unknown>

const RUN = {
  projectId: SEED_PROJECT,
  mode: 'normal',
  seed: 7,
  gitCommit: null,
  gitBranch: null,
  variaVersion: '0.1.0',
  configHash: 'c',
  envHash: 'e',
  planPath: null,
  partial: false,
}

describe('E-07 : arbre Projet → Run → Dossier → Fichier → Test → Call site → Mutation', () => {
  it('dossiers, fichiers, tests filtrés, avec comptes par nœud', async () => {
    expect(await get(`/api/v1/runs/${SEED_RUN}/folders`)).toEqual({
      total: 1,
      limit: 50,
      offset: 0,
      items: [
        {
          folder: 'tests',
          files: 2,
          tests: 2,
          counts: { mutations: 7, crashes: 2, timeouts: 1, unexpected: 0 },
        },
      ],
    })
    const files = (await get(`/api/v1/runs/${SEED_RUN}/files?folder=tests`)).items as {
      file: string
      counts: { mutations: number }
    }[]
    expect(files.map((f) => [f.file, f.counts.mutations])).toEqual([
      ['tests/users.test.js', 7],
      ['tests/values.test.js', 0],
    ])
    expect((await get(`/api/v1/runs/${SEED_RUN}/files?folder=autre`)).total).toBe(0)
    const tests = await get(`/api/v1/runs/${SEED_RUN}/tests?file=tests/values.test.js`)
    expect((tests.items as { testId: string }[]).map((t) => t.testId)).toEqual(['t_2'])
    expect((await get(`/api/v1/runs/${SEED_RUN}/tests?folder=tests&limit=1`)).total).toBe(2)
    expect((await get(`/api/v1/runs/${SEED_RUN}/tests?folder=x`)).total).toBe(0)
  })
  it('test (/tests/:id), call site, mutations filtrées par call site, test et fichier', async () => {
    const t = await get(`/api/v1/tests/t_1?run=${SEED_RUN}`)
    expect(t).toMatchObject({
      runId: SEED_RUN,
      test: { testId: 't_1', callSites: 1, counts: { mutations: 7 } },
      callSites: { total: 1, items: [{ callSiteId: 'c_1', target: 'src/users.js#createUser' }] },
    })
    // Sans `run` : dernier run (SEED_RUN_2 n'enregistre aucun test).
    expect(await get('/api/v1/tests/t_1')).toEqual({ error: 'TEST_NOT_FOUND' })
    expect((await get(`/api/v1/tests/t_1?run=${SEED_RUN_2}`)).error).toBe('TEST_NOT_FOUND')
    expect(await get('/api/v1/tests/zz')).toEqual({ error: 'TEST_NOT_FOUND' })
    expect(await get('/api/v1/tests/t_1?run=zz')).toEqual({ error: 'RUN_NOT_FOUND' })
    expect(await get(`/api/v1/runs/${SEED_RUN}/call-sites/c_1`)).toMatchObject({
      callSite: { testId: 't_1', counts: { mutations: 7, crashes: 2 } },
      test: { name: 'createUser crée un utilisateur valide' },
    })
    expect(await get(`/api/v1/runs/${SEED_RUN}/call-sites/zz`)).toEqual({
      error: 'CALL_SITE_NOT_FOUND',
    })
    const base = `/api/v1/runs/${SEED_RUN}/mutations`
    expect((await get(`${base}?callSite=c_1&status=CRASH`)).total).toBe(2)
    expect((await get(`${base}?test=t_2`)).total).toBe(0)
    expect((await get(`${base}?file=tests/users.test.js`)).total).toBe(7)
    expect((await get(`${base}?callSite=zz`)).total).toBe(0)
  })
  it('capacités déclarées, vérifiées (portées par le rapport), limites', async () => {
    const c = await get(`/api/v1/runs/${SEED_RUN}/capabilities`)
    expect(c).toMatchObject({ adapter: 'jest', declared: { esm: false } })
    expect(c).toMatchObject({
      verifiedAt: null,
      verified: { esm: { status: 'UNSUPPORTED', reason: 'NOT_DECLARED' } },
    })
    expect(c.limitations).toContain('NATIVE_ESM_UNSUPPORTED')
  })
  it('not covered : sections paginées, `section` choisit celle que `offset` décale', async () => {
    const all = (await get(`/api/v1/runs/${SEED_RUN}/not-covered`)) as {
      sections: Record<string, { total: number; items: unknown[] }>
      pendingMutations: number
    }
    expect(Object.keys(all.sections)).toEqual([
      'neverCalled',
      'transitiveOnly',
      'unsupported',
      'nonMutableInputs',
      'flakyTests',
      'skippedMutations',
    ])
    expect(all.sections['neverCalled']).toEqual({
      total: 1,
      limit: 50,
      offset: 0,
      items: ['src/math.js#helper'],
    })
    expect(all.pendingMutations).toBe(1)
    const shifted = (await get(
      `/api/v1/runs/${SEED_RUN}/not-covered?section=neverCalled&offset=1&limit=5`,
    )) as typeof all
    expect(shifted.sections['neverCalled']).toMatchObject({ offset: 1, items: [] })
    expect(shifted.sections['unsupported']).toMatchObject({ offset: 0, limit: 5 })
  })
  it('dossier racine noté « . »', () => {
    expect([folderOf('a.test.js'), folderOf('a/b/c.test.js')]).toEqual(['.', 'a/b'])
  })
  it('sans base : routes de run et /tests/:id ⇒ 404', async () => {
    const s = buildServer({
      dataDir: mkdtempSync(join(tmpdir(), 'varia-nodb-')),
      env: {},
      dashboardDir: noDash,
    })
    for (const url of [`/api/v1/runs/${SEED_RUN}/folders`, '/api/v1/tests/t_1'])
      expect((await s.app.inject({ url })).statusCode).toBe(404)
    await s.app.close()
    const dir = mkdtempSync(join(tmpdir(), 'varia-vide-'))
    openWriter(join(dir, 'varia.db')).close()
    const e = buildServer({ dataDir: dir, env: {}, dashboardDir: noDash })
    expect((await e.app.inject({ url: '/api/v1/tests/t_1' })).json()).toEqual({
      error: 'RUN_NOT_FOUND',
    })
    await e.app.close()
  })
})

describe('E-07 : agrégats mémoïsés par run immuable', () => {
  it('un run terminé est construit une seule fois pour toutes les routes', async () => {
    const before = (aggregates as Aggregates).builds
    for (const sub of ['summary', 'mutations', 'folders', 'tests', 'not-covered', 'coverage'])
      await get(`/api/v1/runs/${SEED_RUN_2}/${sub}`)
    await get('/api/v1/history')
    // SEED_RUN_2 (et au plus SEED_RUN via /history) : jamais une reconstruction par requête.
    expect((aggregates as Aggregates).builds - before).toBeLessThanOrEqual(2)
    const again = (aggregates as Aggregates).builds
    await get(`/api/v1/runs/${SEED_RUN_2}/summary`)
    await get('/api/v1/history')
    expect((aggregates as Aggregates).builds).toBe(again)
  })
  it('run en cours : recalculé ; changement d’état : invalidé ; éviction au-delà de la capacité', () => {
    const { dbPath } = seedDatabase()
    const o = openWriter(dbPath)
    const w = new Writer(o.db)
    w.createRun({ ...RUN, id: 'r_live', state: 'MUTATING', info: {} })
    const r = openReader(dbPath)
    const agg = new Aggregates(new Reader(r.db), 1)
    expect(agg.get('nope')).toBeNull()
    agg.get('r_live')
    agg.get('r_live')
    expect(agg.builds).toBe(2)
    agg.get(SEED_RUN)
    agg.get(SEED_RUN)
    expect(agg.builds).toBe(3)
    w.updateRun('r_live', { state: 'COMPLETED' })
    agg.get('r_live') // remplace SEED_RUN (capacité 1)
    agg.get('r_live')
    expect(agg.builds).toBe(4)
    agg.get(SEED_RUN)
    expect(agg.builds).toBe(5)
    r.close()
    o.close()
  })
})

describe('E-07 : charge — run de 20 000 mutations', () => {
  const N = 20_000
  const dir = mkdtempSync(join(tmpdir(), 'varia-charge-'))
  const dbPath = join(dir, 'varia.db')
  const o = openWriter(dbPath)
  const w = new Writer(o.db)
  w.upsertProject({ id: 'p_big', name: 'big', root: '/big', framework: 'jest' })
  w.createRun({ ...RUN, projectId: 'p_big', id: 'r_big', state: 'COMPLETED', info: {} })
  const STATUSES = ['CRASH', 'PASSED', 'UNEXPECTED_FAILURE', 'TIMEOUT', 'SKIPPED']
  o.sqlite.transaction(() => {
    const tests = Array.from({ length: 2000 }, (_, i) => ({
      testId: `t_${String(i)}`,
      file: `tests/d${String(i % 20)}/f${String(i % 200)}.test.js`,
      name: `test ${String(i)}`,
      status: 'passed',
      flakyReasons: [],
    }))
    // Un dossier sans mutation et un call site dont le test n'est pas enregistré.
    w.saveTests('r_big', [
      ...tests,
      {
        testId: 't_vide',
        file: 'zz/vide.test.js',
        name: 'vide',
        status: 'passed',
        flakyReasons: [],
      },
    ])
    w.saveCallSites(
      'r_big',
      [
        {
          callSiteId: 'c_orphelin',
          testId: 't_absent',
          module: 'src/x.js',
          export: 'f',
          depth: 0,
          sequence: 0,
          argsFingerprint: 'fp',
          args: [1],
          outcome: { kind: 'return' },
          nonDeterministic: false,
        },
      ].concat(
        tests.flatMap((t, i) =>
          [0, 1].map((s) => ({
            callSiteId: `c_${String(i)}_${String(s)}`,
            testId: t.testId,
            module: `src/m${String(i % 50)}.js`,
            export: 'f',
            depth: 0,
            sequence: s,
            argsFingerprint: 'fp',
            args: [1],
            outcome: { kind: 'return' },
            nonDeterministic: false,
          })),
        ),
      ),
    )
    w.saveMutations(
      'r_big',
      Array.from({ length: N }, (_, k) => {
        const i = k % 2000
        return {
          id: `m_${String(k).padStart(6, '0')}`,
          callSiteId: `c_${String(i)}_${String(k % 2)}`,
          testId: `t_${String(i)}`,
          testFile: `tests/d${String(i % 20)}/f${String(i % 200)}.test.js`,
          module: `src/m${String(i % 50)}.js`,
          export: 'f',
          pathStr: 'arg0',
          strategy: 'type',
          op: 'set',
          original: 1,
          value: 'x'.repeat(k % 7 === 0 ? 1000 : 3),
        }
      }),
    )
    for (let k = 0; k < N; k++)
      w.saveResult('r_big', {
        mutationId: `m_${String(k).padStart(6, '0')}`,
        status: STATUSES[k % 5] as string,
        subtype: null,
        reason: k % 5 === 4 ? 'AMBIGUOUS_CALL_SITE' : null,
        outcome: null,
        testStatus: 'failed',
        durationMs: 1,
        exitCode: 1,
        signal: null,
        timedOut: false,
        error: k % 5 === 0 ? { name: 'TypeError', message: 'boom' } : null,
        echoPath: null,
      })
  })()
  o.close()
  const big = buildServer({ dataDir: dir, env: {}, dashboardDir: noDash })
  afterAll(() => big.app.close())

  it('chaque page est bornée en TAILLE et en NOMBRE d’éléments ; un seul agrégat construit', async () => {
    const started = Date.now()
    const pages: [string, number][] = [
      ['/api/v1/runs/r_big/mutations?limit=200&offset=19900', 100],
      ['/api/v1/runs/r_big/mutations?status=CRASH', 50],
      ['/api/v1/runs/r_big/mutations?limit=100000', 200],
      ['/api/v1/runs/r_big/folders', 21],
      ['/api/v1/runs/r_big/files?folder=tests/d3', 10],
      ['/api/v1/runs/r_big/tests?limit=500', 200],
      ['/api/v1/tests/t_7?run=r_big', 2],
      ['/api/v1/history', 1],
      ['/api/v1/runs/r_big/issues', 0],
    ]
    for (const [url, items] of pages) {
      const r = await big.app.inject({ url })
      expect(r.statusCode, url).toBe(200)
      expect(r.body.length, url).toBeLessThan(150_000)
      const body = r.json() as {
        items?: unknown[]
        total?: number
        callSites?: { items: unknown[] }
      }
      expect((body.items ?? body.callSites?.items)?.length, url).toBe(items)
    }
    const summary = await big.app.inject({ url: '/api/v1/runs/r_big/summary' })
    expect(summary.body.length).toBeLessThan(10_000)
    expect(summary.json()).toMatchObject({ counts: { mutations: N, crashes: N / 5 } })
    const nc = await big.app.inject({ url: '/api/v1/runs/r_big/not-covered' })
    expect(nc.body.length).toBeLessThan(20_000)
    expect(
      (nc.json() as { sections: { skippedMutations: { total: number; items: unknown[] } } })
        .sections.skippedMutations,
    ).toMatchObject({ total: N / 5, items: expect.any(Array) as unknown })
    const folder = (
      (await big.app.inject({ url: '/api/v1/runs/r_big/folders?limit=1' })).json() as {
        items: { tests: number; files: number; counts: { mutations: number } }[]
      }
    ).items[0]
    expect(folder).toMatchObject({ files: 10, tests: 100, counts: { mutations: 1000 } })
    expect(
      (await big.app.inject({ url: '/api/v1/runs/r_big/call-sites/c_orphelin' })).json(),
    ).toMatchObject({ test: null, callSite: { counts: { mutations: 0 } } })
    const last = (
      (await big.app.inject({ url: '/api/v1/runs/r_big/folders?offset=20' })).json() as {
        items: unknown[]
      }
    ).items
    expect(last).toEqual([
      {
        folder: 'zz',
        files: 1,
        tests: 1,
        counts: { mutations: 0, crashes: 0, timeouts: 0, unexpected: 0 },
      },
    ])
    expect(summary.json()).toMatchObject({ counts: { unexpected: N / 5 } })
    // Mémoïsation : 16 requêtes sur le même run immuable ⇒ une seule construction.
    expect(big.aggregates?.builds).toBe(1)
    // Temps très large (ne dépend pas de la vitesse de la machine à l'échelle des secondes).
    expect(Date.now() - started).toBeLessThan(120_000)
  }, 180_000)
})

describe('C-01 : rapprochement ambigu exposé', () => {
  it('/issues/:id rend l’état AMBIGUOUS_MATCH et les candidats matchedFrom', async () => {
    const { dataDir: d, dbPath } = seedDatabase()
    const o = openWriter(dbPath)
    new Writer(o.db).saveIssues(SEED_RUN, SEED_PROJECT, [
      {
        fingerprint: 'i_amb',
        state: 'AMBIGUOUS_MATCH',
        kind: 'CRASH',
        severity: 'HIGH',
        target: 'src/users.js#createUser',
        title: 't',
        errorName: 'TypeError',
        frame: null,
        message: 'm',
        mutationIds: ['m_crash1'],
        matchedFrom: ['i_a', 'i_b'],
      },
    ])
    o.close()
    const s = buildServer({ dataDir: d, env: {}, dashboardDir: noDash })
    expect((await s.app.inject({ url: '/api/v1/issues/i_amb' })).json()).toMatchObject({
      occurrence: { state: 'AMBIGUOUS_MATCH' },
      matchedFrom: ['i_a', 'i_b'],
      mutations: [{ id: 'm_crash1' }],
    })
    await s.app.close()
  })
})
