import { seedDatabase } from '@varia/testkit'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../src/index.js'

const noDash = join(mkdtempSync(join(tmpdir(), 'varia-jobs-api-')), 'absent')

class Child extends EventEmitter {
  pid = 99
}
const children: Child[] = []
const killed: number[] = []
const spawned: string[][] = []

function server(withRun: boolean, dataDir = seedDatabase().dataDir) {
  return buildServer({
    dataDir,
    env: {},
    dashboardDir: noDash,
    run: withRun
      ? {
          command: ['node', 'varia.js'],
          globalArgs: ['--lang', 'fr'],
          cwd: tmpdir(),
          env: {},
          info: { name: 'demo', root: '/projet', config: null },
          kill: (pid) => killed.push(pid),
          spawn: ((bin: string, args: string[]) => {
            spawned.push([bin, ...args])
            const c = new Child()
            children.push(c)
            return c
          }) as never,
        }
      : undefined,
  })
}
const session = async (app: ReturnType<typeof server>['app']) =>
  ((await app.inject({ url: '/api/v1/session' })).json() as { token: string }).token

describe('API de lancement : fermée tant que --allow-run est absent', () => {
  const { app } = server(false)
  afterAll(() => app.close())
  it('/health annonce canRun=false ; toutes les routes de travaux répondent 403 RUN_DISABLED', async () => {
    expect(((await app.inject({ url: '/health' })).json() as { canRun: boolean }).canRun).toBe(
      false,
    )
    const token = await session(app)
    const h = { 'x-varia-token': token }
    for (const r of [
      await app.inject({ url: '/api/v1/jobs' }),
      await app.inject({ url: '/api/v1/jobs/j_1' }),
      await app.inject({
        method: 'POST',
        url: '/api/v1/jobs',
        headers: h,
        payload: { kind: 'baseline' },
      }),
      await app.inject({ method: 'DELETE', url: '/api/v1/jobs/j_1', headers: h }),
    ]) {
      expect(r.statusCode).toBe(403)
      expect(r.json()).toEqual({ error: 'RUN_DISABLED' })
    }
  })
  it('sans jeton : 401 avant même de regarder le lanceur', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: { kind: 'baseline' },
    })
    expect(post.statusCode).toBe(401)
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/jobs/j_1' })).statusCode).toBe(401)
  })
})

describe('API de lancement : --allow-run', () => {
  const { app } = server(true)
  afterAll(() => app.close())
  const post = async (payload: unknown, token?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: token === undefined ? {} : { 'x-varia-token': token },
      payload: payload as never,
    })

  it('canRun=true et liste initiale vide avec les infos du projet', async () => {
    expect(((await app.inject({ url: '/health' })).json() as { canRun: boolean }).canRun).toBe(true)
    expect((await app.inject({ url: '/api/v1/jobs' })).json()).toEqual({
      info: { name: 'demo', root: '/projet', config: null },
      items: [],
    })
  })
  it('jeton requis ; paramètres invalides ⇒ 400 avec code stable et bornes', async () => {
    expect((await post({ kind: 'baseline' })).statusCode).toBe(401)
    const token = await session(app)
    const bad = await post({ kind: 'quick', maxMutations: 0 }, token)
    expect(bad.statusCode).toBe(400)
    expect(bad.json()).toMatchObject({ error: 'INVALID_MAX_MUTATIONS', limits: { keep: 10 } })
    expect((await post({ kind: 'rm' }, token)).json()).toMatchObject({ error: 'INVALID_KIND' })
    expect(spawned).toEqual([])
  })
  it('lance, refuse un second travail (409), suit, annule et inconnu ⇒ 404', async () => {
    const token = await session(app)
    const h = { 'x-varia-token': token }
    const ok = await post({ kind: 'quick', maxMutations: 20, maxTimeSeconds: 60 }, token)
    expect(ok.statusCode).toBe(201)
    const { id } = ok.json() as { id: string }
    expect(spawned[0]).toEqual([
      'node',
      'varia.js',
      '--lang',
      'fr',
      'test',
      '--quick',
      '--max-mutations',
      '20',
      '--max-time',
      '60',
    ])
    const busy = await post({ kind: 'baseline' }, token)
    expect(busy.statusCode).toBe(409)
    expect(busy.json()).toEqual({ error: 'JOB_RUNNING' })
    expect(
      ((await app.inject({ url: `/api/v1/jobs/${id}` })).json() as { state: string }).state,
    ).toBe('RUNNING')
    const cancelled = await app.inject({ method: 'DELETE', url: `/api/v1/jobs/${id}`, headers: h })
    expect(cancelled.statusCode).toBe(200)
    expect(killed).toEqual([99])
    children[0]?.emit('exit', null)
    expect(
      ((await app.inject({ url: '/api/v1/jobs' })).json() as { items: { state: string }[] })
        .items[0]?.state,
    ).toBe('CANCELED')
    expect((await app.inject({ url: '/api/v1/jobs/j_zzz' })).statusCode).toBe(404)
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/v1/jobs/j_zzz', headers: h })).statusCode,
    ).toBe(404)
  })
  it('corps absent : refusé proprement (INVALID_KIND), aucun processus', async () => {
    const token = await session(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: { 'x-varia-token': token },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'INVALID_KIND' })
  })
})

describe('Base créée après le démarrage (première baseline)', () => {
  it('le serveur ouvre la base dès qu’elle apparaît', async () => {
    const { dataDir } = seedDatabase()
    const empty = mkdtempSync(join(tmpdir(), 'varia-empty-'))
    const s = server(false, empty)
    expect(
      ((await s.app.inject({ url: '/health' })).json() as { database: boolean }).database,
    ).toBe(false)
    expect(existsSync(join(empty, 'varia.db'))).toBe(false)
    await s.app.close()
    const late = server(false, dataDir)
    expect(
      ((await late.app.inject({ url: '/health' })).json() as { database: boolean }).database,
    ).toBe(true)
    await late.app.close()
  })
})
