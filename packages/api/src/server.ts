import fastifyStatic from '@fastify/static'
import { openReader, Reader, type Opened } from '@varia/database'
import { orqeaUrl } from '@varia/i18n'
import { buildReport } from '@varia/reporters'
import { diffIssues } from '@varia/core'
import Fastify, { type FastifyInstance } from 'fastify'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const API_VERSION = 'v1'
export const VARIA_VERSION = '0.1.0'
export const DASHBOARD_DIST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'dashboard',
  'dist',
)

export interface ServerOptions {
  /** Dossier de données du projet (contient `varia.db`). */
  dataDir: string
  env: NodeJS.ProcessEnv
  port?: number
  host?: string
  dashboardDir?: string
}

const page = (q: { limit?: string; offset?: string }) => ({
  limit: Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200),
  offset: Math.max(Number(q.offset ?? 0) || 0, 0),
})

/**
 * API locale en LECTURE SEULE (CDC §25) : aucune route d'exécution, aucune ingestion (l'orchestrateur
 * reste l'unique écrivaine). Écoute sur 127.0.0.1 ; CSP stricte ; aucune ressource externe.
 */
export function buildServer(o: ServerOptions): { app: FastifyInstance; db: Opened | null } {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 })
  const dbPath = join(o.dataDir, 'varia.db')
  const db = existsSync(dbPath) ? openReader(dbPath) : null
  const reader = db === null ? null : new Reader(db.db)
  const orqea = orqeaUrl(o.env)
  let orqeaOrigin = ''
  try {
    orqeaOrigin = new URL(orqea).origin
  } catch {
    orqeaOrigin = ''
  }
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'${orqeaOrigin !== '' ? ` ${orqeaOrigin}` : ''}`,
    )
  })
  app.addHook('onClose', async () => db?.close())

  app.get('/health', async () => ({
    status: 'ok',
    name: 'varia',
    version: VARIA_VERSION,
    api: API_VERSION,
    orqeaUrl: orqea,
    database: reader !== null,
  }))
  app.get('/version', async () => ({ name: 'varia', version: VARIA_VERSION, api: API_VERSION }))

  const need = () => {
    if (reader === null) throw Object.assign(new Error('NO_DATABASE'), { statusCode: 404 })
    return reader
  }
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/api/v1/runs', async (req) => {
    const r = need()
    const { limit, offset } = page(req.query)
    return { total: r.countRuns(), limit, offset, items: r.listRuns(limit, offset) }
  })
  app.get<{ Params: { id: string } }>('/api/v1/runs/:id', async (req, reply) => {
    const run = need().getRun(req.params.id)
    return run ?? reply.code(404).send({ error: 'RUN_NOT_FOUND' })
  })
  app.get<{ Params: { id: string } }>('/api/v1/runs/:id/summary', async (req, reply) => {
    if (need().getRun(req.params.id) === null)
      return reply.code(404).send({ error: 'RUN_NOT_FOUND' })
    const rep = buildReport(need(), req.params.id)
    return {
      run: rep.run,
      project: rep.project,
      counts: rep.counts,
      resilienceRate: rep.resilienceRate,
      coverage: rep.coverage,
      plan: rep.plan,
      baseline: rep.baseline,
      issues: rep.issues.length,
      critical: rep.issues.filter((i) => i.severity === 'CRITICAL').length,
      limitations: rep.limitations,
      reproducibility: rep.reproducibility,
    }
  })
  app.get<{
    Params: { id: string }
    Querystring: { severity?: string; limit?: string; offset?: string }
  }>('/api/v1/runs/:id/issues', async (req) => {
    const { limit, offset } = page(req.query)
    const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
    const all = need()
      .issues(req.params.id)
      .filter((i) => i.count > 0)
      .filter((i) => req.query.severity === undefined || i.severity === req.query.severity)
      .sort(
        (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || (a.id < b.id ? -1 : 1),
      )
    return { total: all.length, limit, offset, items: all.slice(offset, offset + limit) }
  })
  app.get<{
    Params: { id: string }
    Querystring: { status?: string; limit?: string; offset?: string }
  }>('/api/v1/runs/:id/mutations', async (req, reply) => {
    if (need().getRun(req.params.id) === null)
      return reply.code(404).send({ error: 'RUN_NOT_FOUND' })
    const { limit, offset } = page(req.query)
    const all = buildReport(need(), req.params.id).mutations.filter(
      (m) => req.query.status === undefined || m.status === req.query.status,
    )
    return { total: all.length, limit, offset, items: all.slice(offset, offset + limit) }
  })
  app.get<{ Params: { id: string }; Querystring: { against?: string } }>(
    '/api/v1/runs/:id/diff',
    async (req, reply) => {
      const r = need()
      const run = r.getRun(req.params.id)
      const against =
        req.query.against ??
        (typeof run?.info['comparedTo'] === 'string' ? run.info['comparedTo'] : undefined)
      if (run === null || against === undefined || r.getRun(against) === null)
        return reply.code(404).send({ error: 'RUN_NOT_FOUND' })
      const counts = (id: string) =>
        r
          .issues(id)
          .filter((i) => i.count > 0)
          .map((i) => ({ id: i.id, target: i.target, count: i.count }))
      return {
        run: run.id,
        against,
        diff: diffIssues(counts(against), counts(run.id)),
        states: r.issues(run.id).map((i) => ({ id: i.id, state: i.state, count: i.count })),
      }
    },
  )
  app.get<{ Params: { id: string } }>('/api/v1/runs/:id/not-covered', async (req, reply) => {
    if (need().getRun(req.params.id) === null)
      return reply.code(404).send({ error: 'RUN_NOT_FOUND' })
    const rep = buildReport(need(), req.params.id)
    return { notCovered: rep.notCovered, limitations: rep.limitations, coverage: rep.coverage }
  })
  app.get<{ Params: { id: string } }>('/api/v1/reports/:id', async (req, reply) => {
    if (need().getRun(req.params.id) === null)
      return reply.code(404).send({ error: 'RUN_NOT_FOUND' })
    return buildReport(need(), req.params.id)
  })
  app.get<{ Params: { id: string }; Querystring: { run?: string } }>(
    '/api/v1/issues/:id',
    async (req, reply) => {
      const r = need()
      const issue = r.issue(req.params.id)
      if (issue === null) return reply.code(404).send({ error: 'ISSUE_NOT_FOUND' })
      const history = r.issueHistory(req.params.id)
      const runId = req.query.run ?? history[history.length - 1]?.runId
      const occurrence = history.find((h) => h.runId === runId) ?? null
      const muts =
        runId === undefined
          ? []
          : buildReport(r, runId).mutations.filter((m) => occurrence?.mutationIds.includes(m.id))
      return { issue, occurrence, mutations: muts }
    },
  )
  app.get<{ Params: { id: string } }>('/api/v1/issues/:id/history', async (req) =>
    need().issueHistory(req.params.id),
  )
  app.get<{ Params: { id: string }; Querystring: { run?: string } }>(
    '/api/v1/mutations/:id',
    async (req, reply) => {
      const r = need()
      const runId = req.query.run ?? r.runOfMutation(req.params.id)
      const data = runId === null ? null : r.mutation(runId, req.params.id)
      if (runId === null || data === null)
        return reply.code(404).send({ error: 'MUTATION_NOT_FOUND' })
      const result = r.result(runId, req.params.id)
      return { runId, mutation: data, result, replay: `varia replay ${req.params.id}` }
    },
  )

  const dashboardDir = o.dashboardDir ?? DASHBOARD_DIST
  if (existsSync(dashboardDir)) {
    void app.register(fastifyStatic, { root: dashboardDir, index: ['index.html'] })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'NOT_FOUND' })
      return reply.type('text/html').sendFile('index.html')
    })
  }
  return { app, db }
}

/** Démarre le serveur sur la boucle locale (127.0.0.1 par défaut). */
export async function startServer(
  o: ServerOptions,
): Promise<{ url: string; close(): Promise<void> }> {
  const { app } = buildServer(o)
  const url = await app.listen({ port: o.port ?? 4321, host: o.host ?? '127.0.0.1' })
  return { url, close: () => app.close() }
}
