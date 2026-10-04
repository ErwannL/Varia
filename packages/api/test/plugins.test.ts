import { SEED_PLUGINS, SEED_RUN, SEED_RUN_2, seedDatabase } from '@varia/testkit'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../src/index.js'

// Q-02 : lanceur (version), extensions chargées et défaillances PLUGIN_FAILURE exposées par l'API.
const { dataDir } = seedDatabase(undefined, { second: true })
const { app } = buildServer({ dataDir, env: {}, dashboardDir: '/nonexistent' })
afterAll(() => app.close())
const get = async (url: string) => {
  const r = await app.inject({ url })
  return { status: r.statusCode, json: r.json() as Record<string, unknown> }
}

describe('Q-02 : /api/v1/runs/:id/plugins', () => {
  it('extensions chargées, compteurs par phase, toutes les défaillances', async () => {
    const r = await get(`/api/v1/runs/${SEED_RUN}/plugins`)
    expect(r.status).toBe(200)
    expect(r.json).toEqual({
      // Version non déclarée (codes) ⇒ null, jamais devinée.
      loaded: SEED_PLUGINS.loaded.map((p) => ({ version: null, ...p })),
      byPhase: { load: 1, plan: 0, fuzz: 0, report: 1 },
      failures: { total: 2, limit: 50, offset: 0, items: SEED_PLUGINS.failures },
    })
  })
  it('filtre de phase (compteurs inchangés) et pagination', async () => {
    const r = await get(`/api/v1/runs/${SEED_RUN}/plugins?phase=report`)
    const f = r.json['failures'] as { total: number; items: { code: string }[] }
    expect([f.total, f.items.map((i) => i.code)]).toEqual([1, ['THROWN']])
    expect(r.json['byPhase']).toEqual({ load: 1, plan: 0, fuzz: 0, report: 1 })
    expect(
      (
        (await get(`/api/v1/runs/${SEED_RUN}/plugins?phase=plan`)).json['failures'] as {
          total: number
        }
      ).total,
    ).toBe(0)
    const p2 = (await get(`/api/v1/runs/${SEED_RUN}/plugins?limit=1&offset=1`)).json[
      'failures'
    ] as { total: number; items: { phase: string }[] }
    expect([p2.total, p2.items.map((i) => i.phase)]).toEqual([2, ['report']])
  })
  it('run sans extension : listes vides, compteurs à 0 ; run inconnu : 404', async () => {
    expect((await get(`/api/v1/runs/${SEED_RUN_2}/plugins`)).json).toEqual({
      loaded: [],
      byPhase: { load: 0, plan: 0, fuzz: 0, report: 0 },
      failures: { total: 0, limit: 50, offset: 0, items: [] },
    })
    expect(await get('/api/v1/runs/zz/plugins')).toEqual({
      status: 404,
      json: { error: 'RUN_NOT_FOUND' },
    })
  })
})

describe('Q-02 : compteur PLUGIN_FAILURE et version du lanceur', () => {
  it('résumé : pluginFailures', async () => {
    expect((await get(`/api/v1/runs/${SEED_RUN}/summary`)).json['pluginFailures']).toBe(2)
    expect((await get(`/api/v1/runs/${SEED_RUN_2}/summary`)).json['pluginFailures']).toBe(0)
  })
  it('capacités : adapterVersion du run, null si inconnue', async () => {
    expect((await get(`/api/v1/runs/${SEED_RUN}/capabilities`)).json).toMatchObject({
      adapter: 'jest',
      adapterVersion: '29.7.0',
    })
    expect((await get(`/api/v1/runs/${SEED_RUN_2}/capabilities`)).json['adapterVersion']).toBe(null)
  })
})
