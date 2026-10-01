import { SEED_RUN, seedDatabase } from '@varia/testkit'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../src/index.js'

const dashboardDir = mkdtempSync(join(tmpdir(), 'varia-dash-'))
mkdirSync(dashboardDir, { recursive: true })
writeFileSync(join(dashboardDir, 'index.html'), '<!doctype html><title>Varia</title>')
const { dataDir } = seedDatabase()
const { app } = buildServer({
  dataDir,
  env: { VARIA_ORQEA_URL: 'https://orqea.example' },
  dashboardDir,
})
afterAll(() => app.close())
const get = async (url: string) => {
  const r = await app.inject({ method: 'GET', url })
  return {
    status: r.statusCode,
    json: r.headers['content-type']?.includes('json')
      ? (r.json() as Record<string, unknown>)
      : null,
    headers: r.headers,
    body: r.body,
  }
}

describe('/health (prompt §4.5)', () => {
  it('expose orqeaUrl, nom et version', async () => {
    const r = await get('/health')
    expect(r.json).toMatchObject({
      status: 'ok',
      name: 'varia',
      version: '0.1.0',
      orqeaUrl: 'https://orqea.example',
      database: true,
    })
  })
  it('orqeaUrl par défaut', async () => {
    const s = buildServer({ dataDir, env: {}, dashboardDir })
    expect((await s.app.inject({ url: '/health' })).json()).toMatchObject({
      orqeaUrl: 'https://orqea.dev',
    })
    await s.app.close()
  })
  it('en-têtes de sécurité : CSP stricte, frame-ancestors limité à Orqea', async () => {
    const r = await get('/health')
    expect(String(r.headers['content-security-policy'])).toContain("default-src 'self'")
    expect(String(r.headers['content-security-policy'])).toContain(
      "frame-ancestors 'self' https://orqea.example",
    )
    expect(r.headers['x-content-type-options']).toBe('nosniff')
  })
})

describe('/api/v1 (lecture seule)', () => {
  it('runs paginés', async () => {
    const r = await get('/api/v1/runs?limit=1')
    expect(r.json).toMatchObject({ total: 1, limit: 1, offset: 0 })
    expect(((r.json?.['items'] as unknown[])[0] as Record<string, unknown>)['id']).toBe(SEED_RUN)
  })
  it('run, résumé, issues filtrées, mutations, non couvert, rapport', async () => {
    expect((await get(`/api/v1/runs/${SEED_RUN}`)).json?.['state']).toBe('COMPLETED')
    expect((await get(`/api/v1/runs/${SEED_RUN}/summary`)).json).toMatchObject({
      issues: 3,
      critical: 1,
    })
    expect((await get(`/api/v1/runs/${SEED_RUN}/issues?severity=HIGH`)).json?.['total']).toBe(1)
    expect((await get(`/api/v1/runs/${SEED_RUN}/mutations?status=CRASH`)).json?.['total']).toBe(2)
    expect((await get(`/api/v1/runs/${SEED_RUN}/not-covered`)).json).toHaveProperty('limitations')
    expect((await get(`/api/v1/reports/${SEED_RUN}`)).json?.['schemaVersion']).toBe(1)
  })
  it('issue, historique, mutation', async () => {
    const issues = (await get(`/api/v1/runs/${SEED_RUN}/issues`)).json?.['items'] as {
      id: string
    }[]
    const id = issues[1]?.id ?? ''
    const detail = await get(`/api/v1/issues/${id}`)
    expect((detail.json?.['mutations'] as unknown[]).length).toBe(2)
    expect(((await get(`/api/v1/issues/${id}/history`)).json as unknown as unknown[]).length).toBe(
      1,
    )
    expect((await get('/api/v1/mutations/m_echo')).json).toMatchObject({
      runId: SEED_RUN,
      replay: 'varia replay m_echo',
    })
  })
  it('404 explicites', async () => {
    expect((await get('/api/v1/runs/zz')).status).toBe(404)
    expect((await get('/api/v1/runs/zz/summary')).status).toBe(404)
    expect((await get('/api/v1/issues/zz')).status).toBe(404)
    expect((await get('/api/v1/mutations/zz')).status).toBe(404)
    expect((await get('/api/v1/nope')).status).toBe(404)
  })
  it('aucune route d’écriture', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
      expect((await app.inject({ method, url: `/api/v1/runs/${SEED_RUN}` })).statusCode).toBe(404)
    }
  })
  it('sert le dashboard et renvoie index.html pour les routes du client', async () => {
    expect((await get('/')).body).toContain('<title>Varia</title>')
    expect((await get('/quelque-chose')).body).toContain('<title>Varia</title>')
  })
  it('sans base : /health le dit, les routes de données répondent 404', async () => {
    const s = buildServer({
      dataDir: mkdtempSync(join(tmpdir(), 'varia-empty-')),
      env: {},
      dashboardDir,
    })
    expect((await s.app.inject({ url: '/health' })).json()).toMatchObject({ database: false })
    expect((await s.app.inject({ url: '/api/v1/runs' })).statusCode).toBe(404)
    await s.app.close()
  })
})
