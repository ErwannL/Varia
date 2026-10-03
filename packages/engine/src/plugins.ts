// Intégration des extensions externes (J4 X-02, X-03, docs/extensions.md) : une session par contexte,
// erreurs `PLUGIN_FAILURE` annoncées et consignées dans le run, jamais fatales.
import type { Classification, ObservedCall, PlannedMutation } from '@varia/core'
import type { RunRecord } from '@varia/database'
import {
  loadPlugins,
  ruleInputOf,
  withVerdict,
  type PluginFailure,
  type PluginSession,
  type PluginsSummary,
} from '@varia/plugins'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { EngineContext } from './context.js'

const sessions = new WeakMap<EngineContext, { session: PluginSession; announced: number }>()

/**
 * Session d'extensions du contexte, créée au premier usage (chemins relatifs au fichier de
 * configuration, délai d'appel = `execution.timeout_ms`) et fermée avec le contexte.
 */
export function pluginSession(ctx: EngineContext): PluginSession {
  let s = sessions.get(ctx)
  if (s === undefined) {
    const file = ctx.config.file
    s = {
      session: loadPlugins({
        specifiers: ctx.config.parsed.plugins,
        baseDir: file === null ? ctx.root : dirname(file),
        root: ctx.root,
        timeoutMs: ctx.config.parsed.execution.timeout_ms,
      }),
      announced: 0,
    }
    sessions.set(ctx, s)
    const session = s.session
    ctx.closers.push(() => session.close())
  }
  announce(ctx, s)
  return s.session
}

/** Annonce chaque nouvelle erreur d'extension (avertissement, le run continue). */
function announce(ctx: EngineContext, s: { session: PluginSession; announced: number }): void {
  for (const f of s.session.failures.slice(s.announced)) {
    ctx.emit({ type: 'warning', message: `PLUGIN_FAILURE:${f.code}:${f.extension ?? f.plugin}` })
    ctx.log.warn({ pluginFailure: f }, 'PLUGIN_FAILURE')
  }
  s.announced = s.session.failures.length
}

/** Annonce les erreurs survenues pendant le dernier appel (session déjà créée). */
export function announceNew(ctx: EngineContext): void {
  announce(ctx, sessions.get(ctx) as { session: PluginSession; announced: number })
}

/** Règles d'oracle externes appliquées au verdict de l'oracle intégré (comportements de la cible). */
export function applyPluginRules(
  ctx: EngineContext,
  m: PlannedMutation,
  c: Classification,
  call: ObservedCall | undefined,
): Classification {
  const input = ruleInputOf(m, c, call)
  if (input === null) return c
  const session = pluginSession(ctx)
  const verdict = session.applyRules(input)
  announceNew(ctx)
  return verdict === null ? c : withVerdict(c, verdict)
}

const failureKey = (f: PluginFailure) => [f.plugin, f.extension, f.phase, f.code].join('|')

/**
 * Consigne les extensions chargées et leurs erreurs dans le run (`info.plugins`, lu par le
 * rapport). Les erreurs des commandes précédentes (plan, fuzz, rapport) sont conservées ; une
 * extension est marquée désactivée si une erreur la concerne (ou un délai dépassé de son plugin).
 */
export function recordPlugins(ctx: EngineContext, runId: string): void {
  if (ctx.config.parsed.plugins.length === 0) return
  const run = ctx.reader.getRun(runId) as RunRecord
  const previous = (run.info['plugins'] as PluginsSummary | undefined)?.failures ?? []
  const current = pluginSession(ctx).summary()
  const seen = new Set<string>()
  const failures = [...previous, ...current.failures].filter((f) => {
    const k = failureKey(f)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const loaded = current.loaded.map((p) => ({
    ...p,
    extensions: p.extensions.map((e) => ({
      ...e,
      disabled: failures.some(
        (f) => f.extension === e.id || (f.plugin === p.name && f.code === 'TIMEOUT'),
      ),
    })),
  }))
  ctx.writer.updateRun(runId, { info: { ...run.info, plugins: { loaded, failures } } })
}

/**
 * Rapporteurs externes : chacun reçoit le rapport JSON (construit depuis la base, donc déjà masqué)
 * et écrit `<dossier>/<plugin>.<id>.<extension>`. Rend les chemins écrits.
 */
export function writeExtensionReports(
  ctx: EngineContext,
  runId: string,
  report: Readonly<Record<string, unknown>>,
  dir: string,
): string[] {
  const outputs = pluginSession(ctx).render(report)
  announceNew(ctx)
  mkdirSync(dir, { recursive: true })
  const paths = outputs.map((o) => {
    const file = join(dir, `${o.id.replace('/', '.')}.${o.extension}`)
    writeFileSync(file, o.content)
    return file
  })
  recordPlugins(ctx, runId)
  return paths
}
