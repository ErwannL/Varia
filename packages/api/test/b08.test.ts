import { openWriter, Writer } from '@varia/database'
import { VARIA_VERSION as ENGINE_VERSION } from '@varia/engine'
import { SEED_PROJECT, SEED_RUN, SEED_RUN_2, seedDatabase } from '@varia/testkit'
import { request } from 'node:http'
import { connect, createServer } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer, startServer, VARIA_VERSION } from '../src/index.js'

const noDash = join(mkdtempSync(join(tmpdir(), 'varia-nodash-')), 'absent')
const { dataDir } = seedDatabase()
const { app } = buildServer({ dataDir, env: {}, dashboardDir: noDash })
afterAll(() => app.close())
const inject = (url: string, host?: string) =>
  app.inject({ url, ...(host === undefined ? {} : { headers: { host } }) })

/** Requête HTTP locale (boucle 127.0.0.1) avec un en-tête Host choisi. */
const local = (port: number, host: string) =>
  new Promise<{ status: number; body: string }>((ok, ko) => {
    const req = request({ host: '127.0.0.1', port, path: '/version', headers: { host } }, (res) => {
      let body = ''
      res.on('data', (c: Buffer) => (body += c.toString()))
      res.on('end', () => ok({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', ko)
    req.end()
  })

describe('B-08 : en-tête Host (anti DNS rebinding)', () => {
  it('hôtes de boucle locale acceptés, autres refusés en 403', async () => {
    for (const h of ['localhost', 'LOCALHOST:80', '127.0.0.1:4321', '[::1]:4321'])
      expect((await inject('/health', h)).statusCode).toBe(200)
    for (const h of ['evil.example', 'evil.example:4321', '127.0.0.1.evil:80', 'a:b:c']) {
      const r = await inject('/health', h)
      expect(r.statusCode).toBe(403)
      expect(r.json()).toEqual({ error: 'FORBIDDEN_HOST' })
    }
  })
  it('en écoute : seul le port lié est accepté ; startServer ferme proprement', async () => {
    const s = await startServer({ dataDir, env: {}, port: 0, dashboardDir: noDash })
    const port = Number(new URL(s.url).port)
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const okRes = await local(port, `localhost:${String(port)}`)
    expect(okRes.status).toBe(200)
    expect(JSON.parse(okRes.body)).toEqual({ name: 'varia', version: ENGINE_VERSION, api: 'v1' })
    expect((await local(port, `localhost:${String(port + 1)}`)).status).toBe(403)
    expect((await local(port, 'localhost')).status).toBe(403)
    expect((await local(port, `attacker.test:${String(port)}`)).status).toBe(403)
    await s.close()
  })
})

describe('démarrage', () => {
  it('requête HTTP/1.0 sans Host ⇒ 403', async () => {
    const s = await startServer({ dataDir, env: {}, port: 0, dashboardDir: noDash })
    const port = Number(new URL(s.url).port)
    const raw = await new Promise<string>((ok, ko) => {
      const sock = connect(port, '127.0.0.1', () => sock.write('GET /version HTTP/1.0\r\n\r\n'))
      let data = ''
      sock.on('data', (c: Buffer) => (data += c.toString()))
      sock.on('end', () => ok(data))
      sock.on('error', ko)
    })
    expect(raw).toMatch(/^HTTP\/1\.\d 403/)
    expect(raw).toContain('FORBIDDEN_HOST')
    await s.close()
  })
  it('port par défaut 4321 : occupé ⇒ échec explicite EADDRINUSE', async () => {
    const blocker = createServer()
    await new Promise<void>((ok) => {
      blocker.once('error', () => ok())
      blocker.listen(4321, '127.0.0.1', () => ok())
    })
    await expect(
      startServer({ dataDir, env: {}, host: '127.0.0.1', dashboardDir: noDash }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' })
    await new Promise<void>((ok) => blocker.close(() => ok()))
  })
})

describe('B-08 : version unique', () => {
  it('VARIA_VERSION provient de @varia/engine', async () => {
    expect(VARIA_VERSION).toBe(ENGINE_VERSION)
    expect((await inject('/version')).json()).toMatchObject({ version: ENGINE_VERSION })
  })
})

describe('B-08 : 404 JSON pour routes et identifiants inconnus', () => {
  it('sans dashboard : toute route inconnue ⇒ JSON 404', async () => {
    for (const url of ['/api/v1/nope', '/api/autre', '/page']) {
      const r = await inject(url)
      expect(r.statusCode).toBe(404)
      expect(r.json()).toEqual({ error: 'NOT_FOUND' })
    }
  })
  it('run inconnu ⇒ RUN_NOT_FOUND sur toutes les routes de run', async () => {
    for (const sub of ['issues', 'mutations', 'not-covered', 'coverage']) {
      const r = await inject(`/api/v1/runs/zz/${sub}`)
      expect(r.statusCode).toBe(404)
      expect(r.json()).toEqual({ error: 'RUN_NOT_FOUND' })
    }
    expect((await inject('/api/v1/reports/zz')).json()).toEqual({ error: 'RUN_NOT_FOUND' })
    expect((await inject('/api/v1/runs/zz/diff?against=zz')).statusCode).toBe(404)
  })
  it('issue inconnue (historique) et run inconnu en paramètre ⇒ 404, pas 500', async () => {
    const h = await inject('/api/v1/issues/zz/history')
    expect(h.statusCode).toBe(404)
    expect(h.json()).toEqual({ error: 'ISSUE_NOT_FOUND' })
    const items = (await inject(`/api/v1/runs/${SEED_RUN}/issues`)).json() as {
      items: { id: string }[]
    }
    const id = String(items.items[0]?.id)
    const r = await inject(`/api/v1/issues/${id}?run=zz`)
    expect(r.statusCode).toBe(404)
    expect(r.json()).toEqual({ error: 'RUN_NOT_FOUND' })
    expect((await inject(`/api/v1/mutations/m_echo?run=zz`)).statusCode).toBe(404)
  })
  it('diff : référence implicite (comparedTo) ou absente', async () => {
    const { dataDir: d } = seedDatabase(undefined, { second: true })
    const s = buildServer({ dataDir: d, env: {}, dashboardDir: noDash })
    expect((await s.app.inject({ url: `/api/v1/runs/${SEED_RUN_2}/diff` })).json()).toMatchObject({
      run: SEED_RUN_2,
      against: SEED_RUN,
    })
    expect((await s.app.inject({ url: `/api/v1/runs/${SEED_RUN}/diff` })).statusCode).toBe(404)
    await s.app.close()
  })
  it('dashboard par défaut : le serveur démarre sans option dashboardDir', async () => {
    const s = buildServer({ dataDir, env: {} })
    expect((await s.app.inject({ url: '/health' })).statusCode).toBe(200)
    await s.app.close()
  })
})

describe('cas limites de lecture', () => {
  it('pagination : valeurs non numériques ⇒ défauts', async () => {
    expect((await inject('/api/v1/runs?limit=abc&offset=-3')).json()).toMatchObject({
      limit: 50,
      offset: 0,
    })
  })
  it('URL Orqea invalide : CSP sans origine supplémentaire', async () => {
    const s = buildServer({
      dataDir,
      env: { VARIA_ORQEA_URL: 'pas une url' },
      dashboardDir: noDash,
    })
    const csp = String((await s.app.inject({ url: '/health' })).headers['content-security-policy'])
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp.endsWith("frame-ancestors 'self'")).toBe(true)
    await s.app.close()
  })
  it('POST sans corps ⇒ 400 ; base sans run ⇒ aucune acceptation', async () => {
    const token = ((await inject('/api/v1/session')).json() as { token: string }).token
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/acceptances',
      headers: { 'x-varia-token': token },
    })
    expect(r.statusCode).toBe(400)
    const dir = mkdtempSync(join(tmpdir(), 'varia-vide-'))
    openWriter(join(dir, 'varia.db')).close()
    const s = buildServer({ dataDir: dir, env: {}, dashboardDir: noDash })
    expect((await s.app.inject({ url: '/api/v1/acceptances' })).json()).toEqual([])
    await s.app.close()
  })
  it('issues de même sévérité triées par identifiant ; issue hors run ou sans historique', async () => {
    const { dataDir: d, dbPath } = seedDatabase()
    const o = openWriter(dbPath)
    const w = new Writer(o.db)
    const issue = (id: string) => ({
      fingerprint: id,
      kind: 'ERROR',
      severity: 'LOW',
      target: 'src/users.js#createUser',
      title: id,
      errorName: null,
      frame: null,
      message: null,
      mutationIds: ['m_echo'],
    })
    w.saveIssues(SEED_RUN, SEED_PROJECT, [issue('zz_c'), issue('zz_a'), issue('zz_b')])
    w.createRun({
      id: 'r_vide',
      projectId: SEED_PROJECT,
      state: 'COMPLETED',
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
    o.close()
    const s = buildServer({ dataDir: d, env: {}, dashboardDir: noDash })
    const low = (
      (await s.app.inject({ url: `/api/v1/runs/${SEED_RUN}/issues?severity=LOW` })).json() as {
        items: { id: string }[]
      }
    ).items.map((i) => i.id)
    expect(low.filter((x) => x.startsWith('zz_'))).toEqual(['zz_a', 'zz_b', 'zz_c'])
    expect((await s.app.inject({ url: '/api/v1/issues/zz_a?run=r_vide' })).json()).toMatchObject({
      occurrence: null,
      mutations: [],
    })
    await s.app.close()
    // Runs purgés : l'issue subsiste sans historique.
    const o2 = openWriter(dbPath)
    new Writer(o2.db).prune(SEED_PROJECT, 0)
    o2.close()
    const s2 = buildServer({ dataDir: d, env: {}, dashboardDir: noDash })
    const r = await s2.app.inject({ url: '/api/v1/issues/zz_a' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ occurrence: null, mutations: [] })
    await s2.app.close()
  })
})
