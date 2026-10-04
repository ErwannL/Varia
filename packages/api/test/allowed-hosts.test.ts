import { VariaError } from '@varia/engine'
import { seedDatabase } from '@varia/testkit'
import { request } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer, startServer } from '../src/index.js'

const noDash = join(mkdtempSync(join(tmpdir(), 'varia-allowed-')), 'absent')
const { dataDir } = seedDatabase()

/** Requête vers la boucle locale avec un Host (et un Origin) choisis. */
const call = (port: number, headers: Record<string, string>) =>
  new Promise<number>((ok, ko) => {
    const req = request({ host: '127.0.0.1', port, path: '/version', headers }, (res) => {
      res.resume()
      res.on('end', () => ok(res.statusCode ?? 0))
    })
    req.on('error', ko)
    req.end()
  })

describe('VARIA_ALLOWED_HOSTS (conteneur à port publié)', () => {
  const { app } = buildServer({
    dataDir,
    env: { VARIA_ALLOWED_HOSTS: 'varia.test,localhost:7777' },
    dashboardDir: noDash,
  })
  afterAll(() => app.close())
  const get = (host: string, origin?: string) =>
    app.inject({
      url: '/health',
      headers: { host, ...(origin === undefined ? {} : { origin }) },
    })

  it('sans port lié : un hôte listé passe, un hôte inconnu reste refusé en 403', async () => {
    expect((await get('varia.test')).statusCode).toBe(200)
    expect((await get('VARIA.test:4321')).statusCode).toBe(200)
    expect((await get('localhost')).statusCode).toBe(200)
    const r = await get('attacker.test')
    expect(r.statusCode).toBe(403)
    expect(r.json()).toEqual({ error: 'FORBIDDEN_HOST' })
  })
  it('Origin : un hôte listé en http passe ; https, autre hôte ou valeur illisible sont refusés', async () => {
    expect((await get('varia.test', 'http://varia.test:4321')).statusCode).toBe(200)
    expect((await get('varia.test', 'http://localhost:7777')).statusCode).toBe(200)
    expect((await get('varia.test', 'https://varia.test')).statusCode).toBe(403)
    expect((await get('varia.test', 'http://attacker.test')).statusCode).toBe(403)
    expect((await get('varia.test', 'pas une url')).statusCode).toBe(403)
  })
})

describe('VARIA_ALLOWED_HOSTS en écoute (port publié différent du port lié)', () => {
  it('l’entrée avec port est acceptée ; sans port, seul le port lié ; le reste est refusé', async () => {
    const s = await startServer({
      dataDir,
      env: { VARIA_ALLOWED_HOSTS: 'localhost:7777,named.test' },
      port: 0,
      dashboardDir: noDash,
    })
    const bound = Number(new URL(s.url).port)
    expect(await call(bound, { host: 'localhost:7777' })).toBe(200)
    expect(await call(bound, { host: 'localhost:7777', origin: 'http://localhost:7777' })).toBe(200)
    expect(await call(bound, { host: `named.test:${String(bound)}` })).toBe(200)
    expect(await call(bound, { host: 'named.test:7777' })).toBe(403)
    expect(await call(bound, { host: 'localhost:7778' })).toBe(403)
    await s.close()
  })
})

describe('configuration invalide', () => {
  it('VARIA_ALLOWED_HOSTS invalide ⇒ le serveur refuse de démarrer (erreur de configuration)', () => {
    expect(() =>
      buildServer({ dataDir, env: { VARIA_ALLOWED_HOSTS: 'pas valide' }, dashboardDir: noDash }),
    ).toThrow(VariaError)
  })
})
