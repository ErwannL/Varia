import fastifyStatic from '@fastify/static'
import { openReader, openWriter, Reader, Writer, type Opened } from '@varia/database'
import { orqeaUrl } from '@varia/i18n'
import {
  hostHeaderAllowed,
  JobRunner,
  parseAllowedHosts,
  VARIA_VERSION,
  type JobRunnerOptions,
} from '@varia/engine'
import Fastify, { type FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Aggregates } from './aggregates.js'
import { API_VERSION, defineRoutes } from './routes.js'

export { API_VERSION }
/** Version unique, définie par `@varia/engine` (aucune copie locale). */
export { VARIA_VERSION }
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
  /** `--allow-run` : lancer baseline/tests depuis le tableau de bord. Absent ⇒ lecture seule. */
  run?: Omit<JobRunnerOptions, 'logDir'> | undefined
}

/**
 * API locale en LECTURE SEULE par défaut (CDC §25) : aucune ingestion (l'orchestrateur
 * reste l'unique écrivaine). Écoute sur 127.0.0.1 ; CSP stricte ; aucune ressource externe.
 */
export function buildServer(o: ServerOptions): {
  app: FastifyInstance
  db: Opened | null
  aggregates: Aggregates | null
  /** Routes effectivement enregistrées (méthode, URL), relevées par le crochet `onRoute`. */
  routes: { method: string; url: string }[]
} {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 })
  const dbPath = join(o.dataDir, 'varia.db')
  // Ouverture paresseuse : la première baseline CRÉE la base après le démarrage du serveur.
  let db: Opened | null = null
  let reader: Reader | null = null
  let aggregates: Aggregates | null = null
  const ensureDb = (): void => {
    if (db !== null || !existsSync(dbPath)) return
    db = openReader(dbPath)
    reader = new Reader(db.db)
    aggregates = new Aggregates(reader)
  }
  ensureDb()
  const runner =
    o.run === undefined
      ? null
      : new JobRunner({ ...o.run, logDir: mkdtempSync(join(tmpdir(), 'varia-jobs-')) })
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
  app.addHook('onClose', async () => {
    runner?.close()
    db?.close()
  })

  // Anti « DNS rebinding » : seul un en-tête Host de boucle locale (ou listé dans VARIA_ALLOWED_HOSTS,
  // pour un port publié par un conteneur) et, en écoute, le bon port passent ; l'en-tête Origin, s'il
  // est présent, doit désigner un hôte autorisé en http.
  const allowedHosts = parseAllowedHosts(o.env.VARIA_ALLOWED_HOSTS)
  app.addHook('onRequest', async (req, reply) => {
    const address = app.server.address()
    const bound = typeof address === 'object' && address !== null ? address.port : null
    const m = /^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/.exec(req.headers.host ?? '')
    let ok = m !== null && hostHeaderAllowed(String(m[1]), m[2], bound, allowedHosts)
    const origin = req.headers.origin
    if (ok && origin !== undefined) {
      const u = URL.canParse(origin) ? new URL(origin) : null
      ok =
        u !== null &&
        u.protocol === 'http:' &&
        hostHeaderAllowed(u.hostname, u.port, bound, allowedHosts)
    }
    if (!ok) return reply.code(403).send({ error: 'FORBIDDEN_HOST' })
  })

  // Écritures publiques limitées aux acceptations (CDC §25.1), avec un jeton local par démarrage.
  let writer: { w: Writer; close(): void } | null = null
  app.addHook('onClose', async () => writer?.close())
  // Toutes les routes viennent de `defineRoutes` : la même liste produit l'OpenAPI (B-08).
  const routes: { method: string; url: string }[] = []
  app.addHook('onRoute', (r) => {
    for (const method of [r.method].flat()) routes.push({ method, url: r.url })
  })
  const defs = defineRoutes({
    version: VARIA_VERSION,
    orqeaUrl: orqea,
    token: randomBytes(24).toString('hex'),
    get reader() {
      ensureDb()
      return reader
    },
    get aggregates() {
      ensureDb()
      return aggregates
    },
    runner,
    writer() {
      if (writer === null) {
        const o2 = openWriter(dbPath)
        writer = { w: new Writer(o2.db), close: () => o2.close() }
      }
      return writer.w
    },
  })
  for (const d of defs) app.route({ method: d.method, url: d.url, handler: d.handler })

  const dashboardDir = o.dashboardDir ?? DASHBOARD_DIST
  const dashboard = existsSync(dashboardDir)
  if (dashboard) void app.register(fastifyStatic, { root: dashboardDir, index: ['index.html'] })
  // Route inconnue : JSON 404 sous /api (et sans dashboard), sinon index.html (routage client).
  app.setNotFoundHandler((req, reply) => {
    if (!dashboard || req.url.startsWith('/api/'))
      return reply.code(404).send({ error: 'NOT_FOUND' })
    return reply.type('text/html').sendFile('index.html')
  })
  return { app, db, aggregates, routes }
}

/** Démarre le serveur (boucle locale 127.0.0.1 par défaut ; toute autre adresse est décidée par l'appelant). */
export async function startServer(
  o: ServerOptions,
): Promise<{ url: string; close(): Promise<void> }> {
  const { app } = buildServer(o)
  const url = await app.listen({ port: o.port ?? 4321, host: o.host ?? '127.0.0.1' })
  return { url, close: () => app.close() }
}
