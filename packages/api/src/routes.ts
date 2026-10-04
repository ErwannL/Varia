import { diffIssues } from '@varia/core'
import type { Reader, Writer } from '@varia/database'
import { byId } from '@varia/reporters'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { randomBytes } from 'node:crypto'
import type { Aggregates, RunAggregate } from './aggregates.js'
import {
  any,
  arr,
  bool,
  error,
  int,
  map,
  nullable,
  num,
  obj,
  openApi,
  page,
  str,
  type RouteDef,
  type Schema,
} from './openapi.js'

export const API_VERSION = 'v1'

export interface RouteContext {
  version: string
  orqeaUrl: string
  token: string
  reader: Reader | null
  aggregates: Aggregates | null
  writer(): Writer
}

type Q = Record<string, string | undefined>
const q = (req: FastifyRequest) => req.query as Q
const p = (req: FastifyRequest) => req.params as { id: string; callSiteId: string }

/** Pagination côté serveur : `limit` borné à [1, 200] (50 par défaut), `offset` ≥ 0. */
export const paging = (query: Q) => ({
  limit: Math.min(Math.max(Number(query['limit']) || 50, 1), 200),
  offset: Math.max(Number(query['offset']) || 0, 0),
})
const slice = <T>(all: T[], query: Q) => {
  const { limit, offset } = paging(query)
  return { total: all.length, limit, offset, items: all.slice(offset, offset + limit) }
}
const PAGING = { limit: int, offset: int }
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']

// Schémas de réponse (documentés dans l'OpenAPI et vérifiés par les tests).
const nodeCounts = obj({ mutations: int, crashes: int, timeouts: int, unexpected: int })
const run = obj({
  id: str,
  projectId: str,
  state: str,
  mode: str,
  seed: nullable(int),
  gitCommit: nullable(str),
  gitBranch: nullable(str),
  variaVersion: str,
  configHash: str,
  envHash: str,
  planPath: nullable(str),
  partial: bool,
  info: map(any),
  createdAt: str,
  updatedAt: str,
})
const counts = map(int)
const issue = obj({
  id: str,
  kind: str,
  severity: str,
  state: str,
  target: str,
  title: str,
  errorName: nullable(str),
  message: nullable(str),
  frame: nullable(str),
  count: int,
  mutationIds: arr(str),
})
const mutationRow = obj({
  id: str,
  target: str,
  test: str,
  path: str,
  strategy: str,
  original: any,
  value: any,
  deleted: bool,
  status: nullable(str),
  subtype: nullable(str),
  reason: nullable(str),
  error: nullable(obj({ name: str, message: str })),
  callSiteId: str,
  testId: str,
  file: str,
})
const test = obj({
  testId: str,
  file: str,
  folder: str,
  name: str,
  status: str,
  flaky: bool,
  callSites: int,
  counts: nodeCounts,
})
const callSite = obj({
  callSiteId: str,
  testId: str,
  target: str,
  depth: int,
  sequence: int,
  nonDeterministic: bool,
  counts: nodeCounts,
})
const coverage = obj({ targets: map(int), inputs: map(int) })
const historyPoint = obj({
  id: str,
  createdAt: str,
  state: str,
  partial: bool,
  counts,
  issues: int,
  critical: int,
})
const acceptance = obj(
  {
    id: str,
    projectId: str,
    function: str,
    path: nullable(str),
    strategy: nullable(str),
    reason: str,
    owner: nullable(str),
    expires: nullable(str),
  },
  [],
)
/** Phases d'une défaillance d'extension (rapport v4, `plugins.failures[].phase`). */
const PLUGIN_PHASES = ['load', 'plan', 'fuzz', 'report']
const pluginLoaded = obj({
  name: str,
  specifier: str,
  apiVersion: int,
  version: nullable(str),
  extensions: arr(
    obj({ kind: str, id: str, disabled: bool, fileExtension: str }, ['fileExtension']),
  ),
})
const pluginFailure = obj({
  origin: str,
  plugin: str,
  extension: nullable(str),
  phase: str,
  code: str,
  message: str,
})
const health = obj({
  status: str,
  name: str,
  version: str,
  api: str,
  orqeaUrl: str,
  database: bool,
})
const version = obj({ name: str, version: str, api: str })
const ok = (s: Schema): Record<number, Schema> => ({ 200: s, 404: error })
const runNotFound = { error: 'RUN_NOT_FOUND' }

/** Sections de « Not covered », chacune paginée indépendamment. */
const NC_SECTIONS = [
  'neverCalled',
  'transitiveOnly',
  'unsupported',
  'nonMutableInputs',
  'flakyTests',
  'mockedTargets',
  'skippedMutations',
] as const

/** Toutes les routes de l'API : enregistrées ET documentées depuis cette liste. */
export function defineRoutes(ctx: RouteContext): RouteDef[] {
  const need = (): Reader => {
    if (ctx.reader === null) throw Object.assign(new Error('NO_DATABASE'), { statusCode: 404 })
    return ctx.reader
  }
  const aggregate = (id: string): RunAggregate | null => {
    need()
    return (ctx.aggregates as Aggregates).get(id)
  }
  /** Route d'un run : 404 cohérent si le run est inconnu. */
  const forRun =
    (fn: (a: RunAggregate, req: FastifyRequest, reply: FastifyReply) => unknown) =>
    (req: FastifyRequest, reply: FastifyReply) => {
      const a = aggregate(p(req).id)
      return a === null ? reply.code(404).send(runNotFound) : fn(a, req, reply)
    }
  const authorized = (req: FastifyRequest) => req.headers['x-varia-token'] === ctx.token
  const healthBody = () => ({
    status: 'ok',
    name: 'varia',
    version: ctx.version,
    api: API_VERSION,
    orqeaUrl: ctx.orqeaUrl,
    database: ctx.reader !== null,
  })
  const versionBody = () => ({ name: 'varia', version: ctx.version, api: API_VERSION })

  const defs: RouteDef[] = [
    {
      method: 'GET',
      url: '/health',
      summary: 'État du serveur',
      responses: { 200: health },
      handler: healthBody,
    },
    {
      method: 'GET',
      url: '/api/v1/health',
      summary: 'État du serveur (alias versionné)',
      responses: { 200: health },
      handler: healthBody,
    },
    {
      method: 'GET',
      url: '/version',
      summary: 'Version de Varia',
      responses: { 200: version },
      handler: versionBody,
    },
    {
      method: 'GET',
      url: '/api/v1/version',
      summary: 'Version de Varia (alias versionné)',
      responses: { 200: version },
      handler: versionBody,
    },
    {
      method: 'GET',
      url: '/api/v1/openapi.json',
      summary: 'Document OpenAPI 3.1 généré depuis les définitions de routes',
      responses: { 200: obj({ openapi: str, info: map(any), paths: map(any) }, []) },
      handler: () => openApi(defs, ctx.version),
    },
    {
      method: 'GET',
      url: '/api/v1/session',
      summary: "Jeton d'écriture local (même origine uniquement)",
      responses: { 200: obj({ token: str }), 403: error },
      handler: (req, reply) => {
        // Jeton lisible uniquement par une page de même origine (aucun en-tête CORS n'est émis).
        const site = req.headers['sec-fetch-site']
        if (site !== undefined && site !== 'same-origin')
          return reply.code(403).send({ error: 'FORBIDDEN' })
        return { token: ctx.token }
      },
    },
    {
      method: 'GET',
      url: '/api/v1/acceptances',
      summary: 'Acceptations du projet',
      responses: ok(arr(map(any))),
      handler: () => {
        const r = need()
        const project = r.listRuns(1)[0]?.projectId
        return project === undefined ? [] : r.acceptances(project)
      },
    },
    {
      method: 'POST',
      url: '/api/v1/acceptances',
      summary: 'Crée une acceptation (jeton requis)',
      body: obj(
        { function: str, reason: str, path: str, strategy: str, owner: str, expires: str },
        ['path', 'strategy', 'owner', 'expires'],
      ),
      responses: { 201: acceptance, 400: error, 401: error, 404: error },
      handler: (req, reply) => {
        if (!authorized(req)) return reply.code(401).send({ error: 'TOKEN_REQUIRED' })
        const b = (req.body ?? {}) as Record<string, unknown>
        const s = (v: unknown) =>
          typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 500) : null
        const project = need().listRuns(1)[0]?.projectId
        const fn = s(b['function'])
        const reason = s(b['reason'])
        if (fn === null || reason === null || project === undefined)
          return reply.code(400).send({ error: 'INVALID_ACCEPTANCE' })
        if (s(b['expires']) !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(b['expires'])))
          return reply.code(400).send({ error: 'INVALID_EXPIRES' })
        const a = {
          id: `a_${randomBytes(5).toString('hex')}`,
          projectId: project,
          function: fn,
          path: s(b['path']),
          strategy: s(b['strategy']),
          reason,
          owner: s(b['owner']),
          expires: s(b['expires']),
        }
        ctx.writer().addAcceptance(a)
        return reply.code(201).send(a)
      },
    },
    {
      method: 'DELETE',
      url: '/api/v1/acceptances/:id',
      summary: 'Supprime une acceptation (jeton requis)',
      responses: { 204: null, 401: error, 404: error },
      handler: (req, reply) => {
        if (!authorized(req)) return reply.code(401).send({ error: 'TOKEN_REQUIRED' })
        return ctx.writer().deleteAcceptance(p(req).id)
          ? reply.code(204).send()
          : reply.code(404).send({ error: 'ACCEPTANCE_NOT_FOUND' })
      },
    },
    {
      method: 'GET',
      url: '/api/v1/runs',
      summary: 'Runs, du plus récent au plus ancien (paginés)',
      query: PAGING,
      responses: ok(page(run)),
      handler: (req) => {
        const r = need()
        const { limit, offset } = paging(q(req))
        return { total: r.countRuns(), limit, offset, items: r.listRuns(limit, offset) }
      },
    },
    {
      method: 'GET',
      url: '/api/v1/runs/:id',
      summary: 'Un run',
      responses: ok(run),
      handler: (req, reply) => need().getRun(p(req).id) ?? reply.code(404).send(runNotFound),
    },
    {
      method: 'GET',
      url: '/api/v1/runs/:id/summary',
      summary: "Résumé d'un run (agrégat mémoïsé)",
      responses: ok(
        obj({
          run: map(any),
          project: map(any),
          counts,
          resilienceRate: nullable(num),
          coverage,
          plan: nullable(map(any)),
          baseline: map(any),
          issues: int,
          critical: int,
          pluginFailures: int,
          limitations: arr(str),
          reproducibility: map(any),
        }),
      ),
      handler: forRun(({ report: rep }) => ({
        run: rep.run,
        project: rep.project,
        counts: rep.counts,
        resilienceRate: rep.resilienceRate,
        coverage: rep.coverage,
        plan: rep.plan,
        baseline: rep.baseline,
        issues: rep.issues.length,
        critical: rep.issues.filter((i) => i.severity === 'CRITICAL').length,
        pluginFailures: rep.plugins.failures.length,
        limitations: rep.limitations,
        reproducibility: rep.reproducibility,
      })),
    },
    {
      method: 'GET',
      url: '/api/v1/runs/:id/capabilities',
      summary: 'Capacités déclarées (et vérifiées si mesurées) et limites du run',
      responses: ok(
        obj({
          adapter: str,
          adapterVersion: nullable(str),
          declared: map(bool),
          verified: map(obj({ status: str, reason: nullable(str) })),
          verifiedAt: nullable(str),
          limitations: arr(str),
        }),
      ),
      handler: forRun(({ report }) => ({
        adapter: report.capabilities.adapter,
        adapterVersion: report.capabilities.adapterVersion,
        declared: report.capabilities.declared,
        verified: report.capabilities.verified,
        verifiedAt: report.capabilities.verifiedAt,
        limitations: report.limitations,
      })),
    },
    {
      method: 'GET',
      url: '/api/v1/runs/:id/plugins',
      summary:
        'Extensions chargées pendant le run et défaillances PLUGIN_FAILURE, filtrables par phase (paginées)',
      query: { phase: { enum: PLUGIN_PHASES }, ...PAGING },
      responses: ok(
        obj({ loaded: arr(pluginLoaded), byPhase: map(int), failures: page(pluginFailure) }),
      ),
      handler: forRun(({ report }, req) => {
        const phase = q(req)['phase']
        const all = report.plugins.failures
        return {
          loaded: report.plugins.loaded,
          byPhase: Object.fromEntries(
            PLUGIN_PHASES.map((ph) => [ph, all.filter((f) => f.phase === ph).length]),
          ),
          failures: slice(
            all.filter((f) => phase === undefined || f.phase === phase),
            q(req),
          ),
        }
      }),
    },
    {
      method: 'GET',
      url: '/api/v1/runs/:id/issues',
      summary: "Issues d'un run, par gravité (paginées)",
      query: { severity: { enum: SEVERITIES }, ...PAGING },
      responses: ok(page(issue)),
      handler: forRun((_a, req) => {
        const sev = q(req)['severity']
        const all = need()
          .issues(p(req).id)
          .filter((i) => i.count > 0 && (sev === undefined || i.severity === sev))
          .sort(
            (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || byId(a, b),
          )
        return slice(all, q(req))
      }),
    },
    {
      method: 'GET',
      url: '/api/v1/runs/:id/mutations',
      summary: "Mutations d'un run, filtrables par état, fichier, test, call site (paginées)",
      query: { status: str, file: str, test: str, callSite: str, ...PAGING },
      responses: ok(page(mutationRow)),
      handler: forRun((a, req) => {
        const f = q(req)
        const keep = (v: string | undefined, actual: string | null) =>
          v === undefined || v === actual
        return slice(
          a.mutations.filter(
            (m) =>
              keep(f['status'], m.status) &&
              keep(f['file'], m.file) &&
              keep(f['test'], m.testId) &&
              keep(f['callSite'], m.callSiteId),
          ),
          f,
        )
      }),
    },
    {
      method: 'GET',
      url: '/api/v1/runs/:id/folders',
      summary: 'Dossiers de tests du run (paginés)',
      query: PAGING,
      responses: ok(page(obj({ folder: str, files: int, tests: int, counts: nodeCounts }))),
      handler: forRun((a, req) => slice(a.folders, q(req))),
    },
    {
      method: 'GET',
      url: '/api/v1/runs/:id/files',
      summary: 'Fichiers de tests du run, filtrables par dossier (paginés)',
      query: { folder: str, ...PAGING },
      responses: ok(page(obj({ file: str, folder: str, tests: int, counts: nodeCounts }))),
      handler: forRun((a, req) => {
        const folder = q(req)['folder']
        return slice(
          a.files.filter((f) => folder === undefined || f.folder === folder),
          q(req),
        )
      }),
    },
    {
      method: 'GET',
      url: '/api/v1/runs/:id/tests',
      summary: 'Tests du run, filtrables par dossier ou fichier (paginés)',
      query: { folder: str, file: str, ...PAGING },
      responses: ok(page(test)),
      handler: forRun((a, req) => {
        const f = q(req)
        return slice(
          a.tests.filter(
            (t) =>
              (f['folder'] === undefined || t.folder === f['folder']) &&
              (f['file'] === undefined || t.file === f['file']),
          ),
          f,
        )
      }),
    },
    {
      method: 'GET',
      url: '/api/v1/runs/:id/call-sites/:callSiteId',
      summary: 'Un call site et son test',
      responses: ok(obj({ runId: str, callSite, test: nullable(test) })),
      handler: forRun((a, req, reply) => {
        const c = a.callSites.find((x) => x.callSiteId === p(req).callSiteId)
        if (c === undefined) return reply.code(404).send({ error: 'CALL_SITE_NOT_FOUND' })
        return {
          runId: a.report.run.id,
          callSite: c,
          test: a.tests.find((t) => t.testId === c.testId) ?? null,
        }
      }),
    },
    {
      method: 'GET',
      url: '/api/v1/tests/:id',
      summary: 'Un test et ses call sites (dernier run par défaut, ou `run`)',
      query: { run: str, ...PAGING },
      responses: ok(obj({ runId: str, test, callSites: page(callSite) })),
      handler: (req, reply) => {
        const runId = q(req)['run'] ?? need().listRuns(1)[0]?.id ?? ''
        const a = aggregate(runId)
        if (a === null) return reply.code(404).send(runNotFound)
        const t = a.tests.find((x) => x.testId === p(req).id)
        if (t === undefined) return reply.code(404).send({ error: 'TEST_NOT_FOUND' })
        return {
          runId,
          test: t,
          callSites: slice(
            a.callSites.filter((c) => c.testId === t.testId),
            q(req),
          ),
        }
      },
    },
    {
      method: 'GET',
      url: '/api/v1/runs/:id/diff',
      summary: 'Différence des issues avec un autre run (`against`)',
      query: { against: str },
      responses: ok(obj({ run: str, against: str, diff: map(any), states: arr(map(any)) })),
      handler: (req, reply) => {
        const r = need()
        const target = r.getRun(p(req).id)
        const against =
          q(req)['against'] ??
          (typeof target?.info['comparedTo'] === 'string' ? target.info['comparedTo'] : undefined)
        if (target === null || against === undefined || r.getRun(against) === null)
          return reply.code(404).send(runNotFound)
        const live = (id: string) =>
          r
            .issues(id)
            .filter((i) => i.count > 0)
            .map((i) => ({ id: i.id, target: i.target, count: i.count }))
        return {
          run: target.id,
          against,
          diff: diffIssues(live(against), live(target.id)),
          states: r.issues(target.id).map((i) => ({ id: i.id, state: i.state, count: i.count })),
        }
      },
    },
    {
      method: 'GET',
      url: '/api/v1/runs/:id/not-covered',
      summary:
        'Ce qui n’a pas été observé ni muté ; chaque section est paginée (`section` choisit celle que `offset` décale)',
      query: { section: { enum: [...NC_SECTIONS] }, ...PAGING },
      responses: ok(
        obj({
          sections: obj(Object.fromEntries(NC_SECTIONS.map((s) => [s, page(any)]))),
          pendingMutations: int,
          limitations: arr(str),
          coverage,
        }),
      ),
      handler: forRun(({ report }, req) => {
        const f = q(req)
        const n = report.notCovered
        const lists: Record<(typeof NC_SECTIONS)[number], unknown[]> = {
          neverCalled: n.neverCalled,
          transitiveOnly: n.transitiveOnly,
          unsupported: n.unsupported,
          nonMutableInputs: n.nonMutableInputs,
          flakyTests: n.flakyTests,
          mockedTargets: n.mockedTargets,
          skippedMutations: n.skippedMutations,
        }
        const sections = Object.fromEntries(
          NC_SECTIONS.map((s) => [
            s,
            slice(lists[s], { limit: f['limit'], offset: f['section'] === s ? f['offset'] : '0' }),
          ]),
        )
        return {
          sections,
          pendingMutations: n.pendingMutations,
          limitations: report.limitations,
          coverage: report.coverage,
        }
      }),
    },
    {
      method: 'GET',
      url: '/api/v1/history',
      summary: 'Tendance des runs (paginée, agrégats mémoïsés)',
      query: PAGING,
      responses: ok(page(historyPoint)),
      handler: (req) => {
        const r = need()
        const { limit, offset } = paging(q(req))
        const items = r.listRuns(limit, offset).map((x) => {
          const rep = (aggregate(x.id) as RunAggregate).report
          return {
            id: x.id,
            createdAt: x.createdAt,
            state: x.state,
            partial: rep.run.partial,
            counts: rep.counts,
            issues: rep.issues.length,
            critical: rep.issues.filter((i) => i.severity === 'CRITICAL').length,
          }
        })
        return { total: r.countRuns(), limit, offset, items }
      },
    },
    {
      method: 'GET',
      url: '/api/v1/runs/:id/coverage',
      summary: 'Couverture de base et couverture de mutation',
      responses: ok(
        obj({ baseline: obj({ status: str, files: arr(map(any)) }), mutation: coverage }),
      ),
      handler: forRun(({ report }) => ({
        baseline: report.baselineCoverage,
        mutation: report.coverage,
      })),
    },
    {
      method: 'GET',
      url: '/api/v1/reports/:id',
      summary: 'Rapport JSON complet du run (schéma versionné des rapports)',
      responses: ok(obj({ schemaVersion: int, run: map(any), mutations: arr(map(any)) }, [])),
      handler: forRun(({ report }) => report),
    },
    {
      method: 'GET',
      url: '/api/v1/issues/:id',
      summary: 'Une issue, son occurrence dans un run et ses mutations',
      query: { run: str },
      responses: ok(
        obj({
          issue: map(any),
          occurrence: nullable(map(any)),
          matchedFrom: arr(str),
          mutations: arr(mutationRow),
        }),
      ),
      handler: (req, reply) => {
        const r = need()
        const id = p(req).id
        const found = r.issue(id)
        if (found === null) return reply.code(404).send({ error: 'ISSUE_NOT_FOUND' })
        const history = r.issueHistory(id)
        const runId = q(req)['run'] ?? history[history.length - 1]?.runId
        const a = runId === undefined ? null : aggregate(runId)
        if (runId !== undefined && a === null) return reply.code(404).send(runNotFound)
        const occurrence = history.find((h) => h.runId === runId) ?? null
        const mutations =
          a?.mutations.filter((m) => occurrence?.mutationIds.includes(m.id) === true) ?? []
        // Issues précédentes rapprochées (C-01) : candidats d'un AMBIGUOUS_MATCH, jamais fusionnés.
        const matchedFrom =
          occurrence === null ? [] : (JSON.parse(String(occurrence.matchedFrom)) as string[])
        return { issue: found, occurrence, matchedFrom, mutations }
      },
    },
    {
      method: 'GET',
      url: '/api/v1/issues/:id/history',
      summary: "Occurrences d'une issue dans les runs",
      responses: ok(arr(map(any))),
      handler: (req, reply) => {
        const r = need()
        const id = p(req).id
        if (r.issue(id) === null) return reply.code(404).send({ error: 'ISSUE_NOT_FOUND' })
        return r.issueHistory(id)
      },
    },
    {
      method: 'GET',
      url: '/api/v1/mutations/:id',
      summary: 'Une mutation, son résultat et sa commande de rejeu',
      query: { run: str },
      responses: ok(
        obj({ runId: str, mutation: map(any), result: nullable(map(any)), replay: str }),
      ),
      handler: (req, reply) => {
        const r = need()
        const id = p(req).id
        const runId = q(req)['run'] ?? r.runOfMutation(id)
        const data = runId === null ? null : r.mutation(runId, id)
        if (runId === null || data === null)
          return reply.code(404).send({ error: 'MUTATION_NOT_FOUND' })
        return { runId, mutation: data, result: r.result(runId, id), replay: `varia replay ${id}` }
      },
    },
  ]
  return defs
}
