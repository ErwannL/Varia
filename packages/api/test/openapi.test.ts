import { SEED_RUN, seedDatabase } from '@varia/testkit'
import { mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer, openApi, type RouteDef } from '../src/index.js'

// Validateur JSON Schema 2020-12 (dialecte d'OpenAPI 3.1) : Ajv 8, déjà présent via Fastify.
const fastifyRequire = createRequire(createRequire(import.meta.url).resolve('fastify'))
const ajvRequire = createRequire(fastifyRequire.resolve('@fastify/ajv-compiler'))
const Ajv2020 = (ajvRequire('ajv/dist/2020') as { default: new (o: object) => AjvLike }).default
interface AjvLike {
  compile(s: object): ((v: unknown) => boolean) & { errors?: unknown }
}
const ajv = new Ajv2020({ strict: false, allErrors: true })

const noDash = join(mkdtempSync(join(tmpdir(), 'varia-nodash-')), 'absent')
const { dataDir } = seedDatabase(undefined, { second: true })
const { app, routes } = buildServer({ dataDir, env: {}, dashboardDir: noDash })
afterAll(() => app.close())

interface Doc {
  openapi: string
  info: { version: string }
  paths: Record<
    string,
    Record<
      string,
      {
        operationId: string
        parameters: { name: string; in: string }[]
        requestBody?: unknown
        responses: Record<string, { content?: { 'application/json': { schema: object } } }>
      }
    >
  >
}
const doc = async () => (await app.inject({ url: '/api/v1/openapi.json' })).json() as Doc
const toOpenApi = (url: string) => url.replace(/:(\w+)/g, '{$1}')

describe('B-08 : OpenAPI 3.1 généré depuis les définitions de routes', () => {
  it('servi sur /api/v1/openapi.json, version 3.1, identifiants d’opération uniques', async () => {
    const d = await doc()
    expect(d.openapi).toBe('3.1.0')
    const ops = Object.values(d.paths).flatMap((p) => Object.values(p).map((o) => o.operationId))
    expect(new Set(ops).size).toBe(ops.length)
    expect(d.paths['/api/v1/runs/{id}/call-sites/{callSiteId}']?.['get']?.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'callSiteId', in: 'path', required: true, schema: { type: 'string' } },
    ])
    expect(d.paths['/api/v1/acceptances']?.['post']?.requestBody).toBeDefined()
    expect(d.paths['/api/v1/acceptances/{id}']?.['delete']?.responses['204']).toEqual({
      description: '204',
    })
  })
  it('chaque route ENREGISTRÉE (relevée par onRoute) figure dans le document, et réciproquement', async () => {
    const d = await doc()
    const api = routes.filter(
      (r) =>
        r.method !== 'HEAD' && (r.url.startsWith('/api/') || /^\/(health|version)$/.test(r.url)),
    )
    expect(api.length).toBeGreaterThan(25)
    for (const r of api)
      expect(
        d.paths[toOpenApi(r.url)]?.[r.method.toLowerCase()],
        `${r.method} ${r.url}`,
      ).toBeDefined()
    const documented = Object.entries(d.paths).flatMap(([path, ops]) =>
      Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`),
    )
    expect(documented.sort()).toEqual(api.map((r) => `${r.method} ${toOpenApi(r.url)}`).sort())
  })
  it('routes du CDC §25.3 présentes, dont /tests/:id et les alias /api/v1/health, /api/v1/version', async () => {
    const d = await doc()
    for (const p of [
      '/api/v1/runs',
      '/api/v1/runs/{id}',
      '/api/v1/runs/{id}/summary',
      '/api/v1/runs/{id}/issues',
      '/api/v1/runs/{id}/coverage',
      '/api/v1/runs/{id}/diff',
      '/api/v1/issues/{id}',
      '/api/v1/issues/{id}/history',
      '/api/v1/mutations/{id}',
      '/api/v1/tests/{id}',
      '/api/v1/reports/{id}',
      '/api/v1/health',
      '/api/v1/version',
    ])
      expect(d.paths[p]?.['get'], p).toBeDefined()
    expect((await app.inject({ url: '/api/v1/version' })).json()).toEqual(
      (await app.inject({ url: '/version' })).json(),
    )
    expect((await app.inject({ url: '/api/v1/health' })).json()).toEqual(
      (await app.inject({ url: '/health' })).json(),
    )
  })
  it('chaque réponse réelle est conforme au schéma documenté pour son code', async () => {
    const d = await doc()
    const issue = (
      (await app.inject({ url: `/api/v1/runs/${SEED_RUN}/issues` })).json() as {
        items: { id: string }[]
      }
    ).items[0]?.id
    const sample: Record<string, string> = {
      '/api/v1/issues/{id}': String(issue),
      '/api/v1/issues/{id}/history': String(issue),
      '/api/v1/mutations/{id}': 'm_crash1',
      '/api/v1/tests/{id}': 't_1',
    }
    let checked = 0
    for (const [path, ops] of Object.entries(d.paths)) {
      const get = ops['get']
      if (get === undefined) continue
      for (const known of [true, false]) {
        const id = known ? (sample[path] ?? SEED_RUN) : 'zz'
        const url = path
          .replace('{id}', id)
          .replace('{callSiteId}', known ? 'c_1' : 'zz')
          .replace(/\/diff$/, `/diff?against=${SEED_RUN}`)
        const r = await app.inject({ url, headers: { 'sec-fetch-site': 'same-origin' } })
        const schema = get.responses[String(r.statusCode)]?.content?.['application/json'].schema
        expect(schema, `${url} → ${String(r.statusCode)} non documenté`).toBeDefined()
        const validate = ajv.compile(schema as object)
        expect(validate(r.json()), `${url} : ${JSON.stringify(validate.errors)}`).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(40)
  })
  it('le générateur traduit paramètres, requête et corps', () => {
    const defs: RouteDef[] = [
      {
        method: 'GET',
        url: '/a/:x/b',
        summary: 's',
        query: { n: { type: 'integer' } },
        responses: { 200: { type: 'object' } },
        handler: () => null,
      },
    ]
    const o = openApi(defs, '9.9.9') as unknown as Doc
    expect(o.info.version).toBe('9.9.9')
    expect(o.paths['/a/{x}/b']?.['get']).toMatchObject({
      operationId: 'getAXB',
      parameters: [
        { name: 'x', in: 'path' },
        { name: 'n', in: 'query' },
      ],
    })
  })
})

describe('B-08 : Origin et jeton face à un hôte forgé', () => {
  const session = (headers: Record<string, string>) =>
    app.inject({ url: '/api/v1/session', headers })
  it('Origin présente : seule une boucle locale en http est acceptée', async () => {
    expect((await session({ origin: 'http://localhost:4321' })).statusCode).toBe(200)
    expect((await session({ origin: 'http://127.0.0.1' })).statusCode).toBe(200)
    for (const origin of [
      'http://evil.example',
      'https://localhost:4321',
      'null',
      'http://127.0.0.1.evil:80',
    ]) {
      const r = await session({ origin })
      expect(r.statusCode, origin).toBe(403)
      expect(r.body).not.toMatch(/token/)
    }
  })
  it('le jeton d’écriture n’est JAMAIS remis à une requête d’hôte forgé', async () => {
    for (const headers of [
      { host: 'evil.example' },
      { host: 'evil.example', 'sec-fetch-site': 'same-origin' },
      { host: 'localhost.evil:4321', origin: 'http://localhost.evil:4321' },
      { host: 'localhost', origin: 'http://evil.example' },
    ]) {
      const r = await session(headers)
      expect(r.statusCode).toBe(403)
      expect(r.json()).toEqual({ error: 'FORBIDDEN_HOST' })
    }
    const ok = await session({ host: 'localhost', 'sec-fetch-site': 'same-origin' })
    expect(ok.json()).toMatchObject({ token: expect.stringMatching(/^[0-9a-f]{48}$/) as unknown })
  })
})
