// Commandes d'exécution : baseline, plan, fuzz, test, replay, ci (CDC §27-28).
import {
  EXIT,
  planRun,
  readPlan,
  replayMutation,
  runBaseline,
  savePlan,
  type EngineContext,
  type PlanRunOptions,
} from '@varia/engine'
import { orqeaUrl, t } from '@varia/i18n'
import {
  buildReport,
  ciVerdict,
  githubAnnotations,
  toHtml,
  toJUnit,
  toMarkdown,
  toSarif,
} from '@varia/reporters'
import { copyFileSync, writeFileSync } from 'node:fs'
import type { Printer } from '../io.js'
import {
  filtersOf,
  finishRun,
  fuzzWithSummary,
  modeOf,
  modeOptions,
  targetingOptions,
  type Shared,
  type TargetingOpts,
} from '../shared.js'

interface PlanOpts extends TargetingOpts {
  seed?: string
  maxMutations?: string
  changed?: string | boolean
}

/** Options de planification communes (graine, budget, --changed, ciblage). */
export function planOptionsOf(o: PlanOpts): PlanRunOptions {
  const filters = filtersOf(o)
  return {
    ...(o.seed !== undefined ? { seed: Number(o.seed) } : {}),
    ...(o.maxMutations !== undefined ? { maxMutations: Number(o.maxMutations) } : {}),
    ...(o.changed !== undefined
      ? { changed: typeof o.changed === 'string' ? o.changed : 'HEAD' }
      : {}),
    ...(filters !== undefined ? { filters } : {}),
  }
}

export function printBaseline(p: Printer, s: Awaited<ReturnType<typeof runBaseline>>): void {
  for (const f of s.flaky)
    p.say('cli.baseline.flaky', { name: f.name, reasons: f.reasons.join(', ') })
  p.say('cli.baseline.summary', {
    calls: s.calls,
    observed: s.targets.observed,
    never: s.targets.neverCalled,
    unsupported: s.targets.unsupported,
    mutable: s.inputs.mutable,
    nonMutable: s.inputs.nonMutable,
  })
}

export function printPlan(p: Printer, s: ReturnType<typeof planRun>): void {
  p.say('cli.plan.summary', { planned: s.planned, possible: s.possible, seed: s.seed })
  if (s.sampled) p.say('cli.plan.sampled', { planned: s.planned, possible: s.possible })
  p.say('cli.plan.estimate', { minutes: (s.estimateMs / 60000).toFixed(1) })
  if (s.warn) p.warn('cli.plan.warn')
}

/** Ctrl+C : le run est marqué interrompu, rien n'est perdu (reprise par `--resume`). */
function abortOnSigint(p: () => Printer, runId: () => string | null) {
  const ac = new AbortController()
  const onSig = () => {
    ac.abort()
    const id = runId()
    if (id !== null) p().warn('cli.interrupted', { runId: id })
  }
  process.once('SIGINT', onSig)
  return { signal: ac.signal, dispose: () => process.removeListener('SIGINT', onSig) }
}

const fuzzOpts = (o: { maxTime?: string; cache?: boolean }, signal?: AbortSignal) => ({
  ...(signal !== undefined ? { signal } : {}),
  ...(o.cache === false ? { noCache: true } : {}),
  ...(o.maxTime !== undefined ? { maxTimeMs: Number(o.maxTime) * 1000 } : {}),
})

const PLANNABLE = ['BASELINE_DONE', 'BASELINE_PARTIAL', 'PLANNED']

export function registerRun(s: Shared): void {
  const { program } = s

  modeOptions(
    program
      .command('baseline')
      .description(t(s.locale(), 'cli.cmd.baseline'))
      .option('--allow-failing'),
  ).action((o: { allowFailing?: boolean; quick?: boolean; full?: boolean }) =>
    s.withCtx(modeOf(o), async (ctx) => {
      const b = await runBaseline(ctx, { allowFailing: o.allowFailing === true })
      if (s.p().json) s.p().data(b)
      else printBaseline(s.p(), b)
      return b.state === 'BASELINE_FAILED' ? EXIT.BASELINE : EXIT.OK
    }),
  )

  modeOptions(
    targetingOptions(
      program
        .command('plan')
        .description(t(s.locale(), 'cli.cmd.plan'))
        .option('--changed [base]')
        .option('--seed <n>')
        .option('--max-mutations <n>')
        .option('--out <file>'),
    ),
  ).action((o: PlanOpts & { out?: string; quick?: boolean; full?: boolean }) =>
    s.withCtx(modeOf(o), async (ctx) => {
      const baseId =
        ctx.reader.latestRun(ctx.projectId, PLANNABLE)?.id ?? (await runBaseline(ctx)).runId
      const summary = planRun(ctx, baseId, planOptionsOf(o))
      if (o.out !== undefined) {
        copyFileSync(summary.planPath, s.path(o.out))
        s.p().say('cli.plan.written', { path: s.path(o.out) })
      }
      if (s.p().json) s.p().data(summary)
      else printPlan(s.p(), summary)
      return EXIT.OK
    }),
  )

  program
    .command('fuzz')
    .description(t(s.locale(), 'cli.cmd.fuzz'))
    .option('--no-cache')
    .option('--resume <runId>')
    .option('--plan <file>')
    .option('--max-time <seconds>')
    .option('--force')
    .action((o: { resume?: string; plan?: string; maxTime?: string; force?: boolean }) =>
      s.withCtx(undefined, async (ctx) => {
        let runId: string | null = o.resume ?? null
        const sig = abortOnSigint(s.p, () => runId)
        try {
          if (runId !== null) {
            s.p().say('cli.fuzz.resume', { done: ctx.reader.resultIds(runId).size })
          } else {
            const latest = ctx.reader.latestRun(ctx.projectId, PLANNABLE)
            runId = latest?.id ?? (await runBaseline(ctx, { force: o.force === true })).runId
            if (o.plan !== undefined)
              printPlan(s.p(), savePlan(ctx, runId, readPlan(s.path(o.plan))))
            else if (latest?.state !== 'PLANNED') printPlan(s.p(), planRun(ctx, runId))
          }
          const f = await fuzzWithSummary(s.p(), ctx, runId, fuzzOpts(o, sig.signal))
          if (f.partial) s.p().warn('cli.fuzz.partial', { pending: f.pending })
          const code = finishRun(s.p(), ctx, runId)
          return f.aborted ? EXIT.INTERRUPTED : code
        } finally {
          sig.dispose()
        }
      }),
    )

  modeOptions(
    targetingOptions(
      program
        .command('test')
        .description(t(s.locale(), 'cli.cmd.test'))
        .option('--no-cache')
        .option('--changed [base]')
        .option('--seed <n>')
        .option('--max-mutations <n>')
        .option('--max-time <seconds>')
        .option('--force'),
    ),
  ).action(
    (
      o: PlanOpts & {
        maxTime?: string
        cache?: boolean
        quick?: boolean
        full?: boolean
        force?: boolean
      },
    ) =>
      s.withCtx(modeOf(o), async (ctx) => {
        let runId: string | null = null
        const sig = abortOnSigint(s.p, () => runId)
        try {
          const b = await runBaseline(ctx, { force: o.force === true })
          runId = b.runId
          printBaseline(s.p(), b)
          printPlan(s.p(), planRun(ctx, runId, planOptionsOf(o)))
          const f = await fuzzWithSummary(s.p(), ctx, runId, fuzzOpts(o, sig.signal))
          if (f.partial) s.p().warn('cli.fuzz.partial', { pending: f.pending })
          const code = finishRun(s.p(), ctx, runId)
          return f.aborted ? EXIT.INTERRUPTED : code
        } finally {
          sig.dispose()
        }
      }),
  )

  program
    .command('replay <mutationId>')
    .description(t(s.locale(), 'cli.cmd.replay'))
    .action((id: string) =>
      s.withCtx(undefined, async (ctx) => {
        const r = await replayMutation(ctx, id)
        const p = s.p()
        if (p.json) p.data(r)
        else {
          const c = r.classification
          p.say('cli.replay.result', {
            id,
            target: `${r.mutation.module}#${r.mutation.export}`,
            path: r.mutation.pathStr,
            strategy: r.mutation.strategy,
            status: c.subtype !== undefined ? `${c.status}/${c.subtype}` : c.status,
          })
          if (r.previous !== null)
            p.say('cli.replay.previous', {
              status: r.previous.status,
              same: String(r.sameAsRecorded),
            })
          if (r.environmentChanged) p.warn('cli.replay.envChanged')
        }
        return EXIT.OK
      }),
    )

  modeOptions(
    targetingOptions(
      program
        .command('ci')
        .description(t(s.locale(), 'cli.cmd.ci'))
        .option('--no-cache')
        .option('--changed [base]')
        .option('--json-out <file>')
        .option('--junit <file>')
        .option('--sarif <file>')
        .option('--markdown <file>')
        .option('--html <file>')
        .option('--seed <n>')
        .option('--max-mutations <n>')
        .option('--max-time <seconds>'),
    ),
  ).action(
    (
      o: PlanOpts & {
        jsonOut?: string
        junit?: string
        sarif?: string
        markdown?: string
        html?: string
        maxTime?: string
        cache?: boolean
        quick?: boolean
        full?: boolean
      },
    ) =>
      s.withCtx(modeOf(o), async (ctx) => {
        const b = await runBaseline(ctx)
        planRun(ctx, b.runId, planOptionsOf(o))
        await fuzzWithSummary(s.p(), ctx, b.runId, fuzzOpts(o))
        const report = writeOutputs(s, ctx, b.runId, {
          ...(o.jsonOut !== undefined ? { json: o.jsonOut } : {}),
          ...(o.junit !== undefined ? { junit: o.junit } : {}),
          ...(o.sarif !== undefined ? { sarif: o.sarif } : {}),
          ...(o.markdown !== undefined ? { markdown: o.markdown } : {}),
          ...(o.html !== undefined ? { html: o.html } : {}),
        })
        const ci = ctx.config.parsed.ci
        let reference: Set<string> | null = null
        if (ci.fail_on_new_only_against !== undefined) {
          const ref = ctx.reader
            .listRuns(500)
            .find(
              (r) =>
                r.projectId === ctx.projectId &&
                r.id !== b.runId &&
                r.state === 'COMPLETED' &&
                !r.partial &&
                r.gitBranch === ci.fail_on_new_only_against,
            )
          if (ref === undefined)
            s.p().warn('cli.ci.noReference', { branch: ci.fail_on_new_only_against })
          else {
            s.p().say('cli.ci.against', { run: ref.id, branch: ci.fail_on_new_only_against })
            reference = new Set(
              ctx.reader
                .issues(ref.id)
                .filter((i) => i.count > 0)
                .map((i) => i.id),
            )
          }
        }
        if (s.cli.env['GITHUB_ACTIONS'] === 'true')
          for (const line of githubAnnotations(report)) s.io.out(line)
        const verdict = ciVerdict(report, {
          failOn: ci.fail_on,
          failOnRegression: ci.fail_on_regression,
          reference,
          includeTransitive: ci.include_transitive,
        })
        s.p().say('cli.ci.verdict', {
          verdict: verdict.fail ? 'FAIL' : 'PASS',
          reasons: verdict.reasons.length === 0 ? '—' : verdict.reasons.slice(0, 5).join(', '),
        })
        return verdict.fail ? EXIT.RESILIENCE : EXIT.OK
      }),
  )
}

/** Écrit les formats demandés (JSON, JUnit, SARIF, Markdown, HTML) ; rend le rapport. */
export function writeOutputs(
  s: Shared,
  ctx: EngineContext,
  runId: string,
  o: { json?: string; junit?: string; sarif?: string; markdown?: string; html?: string },
) {
  const report = buildReport(ctx.reader, runId)
  const p = s.p()
  const outputs: [string | undefined, () => string][] = [
    [o.json, () => JSON.stringify(report, null, 2) + '\n'],
    [o.junit, () => toJUnit(report, ctx.config.parsed.ci.fail_on)],
    [o.sarif, () => toSarif(report)],
    [o.markdown, () => toMarkdown(report, p.locale, orqeaUrl(s.cli.env))],
    [o.html, () => toHtml(report, p.locale, orqeaUrl(s.cli.env))],
  ]
  for (const [file, render] of outputs) {
    if (file === undefined) continue
    writeFileSync(s.path(file), render())
    p.say('cli.ci.written', { path: s.path(file) })
  }
  return report
}
