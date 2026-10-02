import { JestAdapter } from '@varia/adapter-jest'
import { VitestAdapter } from '@varia/adapter-vitest'
import type { TestAdapter } from '@varia/core'
import {
  CONFIG_FILES,
  findConfigFile,
  loadConfig,
  printableConfig,
  ConfigError,
} from '@varia/config'
import {
  doctor,
  EngineContext,
  EXIT,
  planRun,
  readPlan,
  replayMutation,
  runBaseline,
  runFuzz,
  savePlan,
  VARIA_VERSION,
  VariaError,
  type ProgressEvent,
} from '@varia/engine'
import { orqeaUrl, resolveLocale, t, type Locale, type MessageKey } from '@varia/i18n'
import {
  buildReport,
  ciVerdict,
  githubAnnotations,
  reportSchema,
  toHtml,
  toJUnit,
  toMarkdown,
  toSarif,
} from '@varia/reporters'
import { diffIssues } from '@varia/core'
import { Command, CommanderError, Option } from 'commander'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { printer, type Io, type Printer } from './io.js'
import { printSummary, resilienceExit } from './summary.js'

/** Choix de l'adapter (le moteur n'en connaît aucun) : `test.framework`, sinon détection par dépendances. */
export function adapterFor(root: string, configFile?: string): TestAdapter {
  let framework: string | undefined
  try {
    framework = loadConfig(root, configFile !== undefined ? { file: configFile } : {}).parsed.test
      .framework
  } catch {
    framework = undefined
  }
  if (framework === undefined) {
    const pkgFile = join(root, 'package.json')
    const pkg = existsSync(pkgFile)
      ? (JSON.parse(readFileSync(pkgFile, 'utf8')) as {
          dependencies?: object
          devDependencies?: object
        })
      : {}
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    framework = 'vitest' in deps && !('jest' in deps) ? 'vitest' : 'jest'
  }
  return framework === 'vitest' ? new VitestAdapter() : new JestAdapter()
}

export interface CliEnv {
  env: NodeJS.ProcessEnv
  cwd: string
  /** Démarre le dashboard (injecté pour garder le CLI indépendant de l'API dans les tests). */
  startDashboard?: (o: {
    dataDir: string
    port: number
    env: NodeJS.ProcessEnv
  }) => Promise<{ url: string; close(): Promise<void> }>
}

interface GlobalOpts {
  dataDir?: string
  lang?: string
  quiet?: boolean
  json?: boolean
  project?: string
  config?: string
}

const MINIMAL_CONFIG =
  'version: 1\ntargets: { mode: auto, include: ["src/**"] }\nmutations: { mode: normal }\noracle:\n  handled_errors: [{ name: ValidationError }]\n'

function progress(p: Printer) {
  return (e: ProgressEvent) => {
    if (e.type === 'baseline')
      p.say('cli.baseline.run', {
        run: e.run,
        of: e.of,
        passed: e.passed,
        total: e.total,
        seconds: (e.durationMs / 1000).toFixed(1),
      })
    else if (e.type === 'mutation')
      p.say('cli.fuzz.progress', {
        index: e.index,
        of: e.of,
        id: e.id,
        status: e.subtype !== undefined ? `${e.status}/${e.subtype}` : e.status,
      })
  }
}

export async function runCli(argv: string[], io: Io, cli: CliEnv): Promise<number> {
  let exitCode: number = EXIT.OK
  let p: Printer = printer(
    io,
    resolveLocale(cli.env['VARIA_LANG'] ?? cli.env['LANG']),
    false,
    false,
  )
  const program = new Command('varia')
  program
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.out(s.trimEnd()), writeErr: (s) => io.err(s.trimEnd()) })
    .option('--data-dir <dir>')
    .option('--lang <lang>')
    .option('-q, --quiet')
    .option('--json')
    .option('-C, --project <dir>')
    .option('-c, --config <file>')
    .version(VARIA_VERSION, '-v, --version')
  const locale = (): Locale => {
    const o = program.opts<GlobalOpts>()
    return o.lang === 'en' || o.lang === 'fr'
      ? o.lang
      : resolveLocale(cli.env['VARIA_LANG'] ?? cli.env['LANG'])
  }
  program.hook('preAction', () => {
    const o = program.opts<GlobalOpts>()
    p = printer(io, locale(), o.quiet === true, o.json === true)
    if (o.quiet !== true && o.json !== true)
      io.err(t(locale(), 'cli.banner', { version: VARIA_VERSION }))
  })
  const root = () => resolve(cli.cwd, program.opts<GlobalOpts>().project ?? '.')
  const context = (mode?: 'quick' | 'normal' | 'full') => {
    const o = program.opts<GlobalOpts>()
    return new EngineContext({
      root: root(),
      adapter: adapterFor(root(), o.config !== undefined ? resolve(cli.cwd, o.config) : undefined),
      ...(o.dataDir !== undefined ? { dataDir: resolve(cli.cwd, o.dataDir) } : {}),
      ...(o.config !== undefined ? { configFile: resolve(cli.cwd, o.config) } : {}),
      ...(mode !== undefined ? { mode } : {}),
      onProgress: progress(p),
    })
  }
  const modeOf = (o: { quick?: boolean; full?: boolean }) =>
    o.quick === true ? 'quick' : o.full === true ? 'full' : undefined
  const finishRun = (ctx: EngineContext, runId: string) => {
    const report = buildReport(ctx.reader, runId)
    const code = resilienceExit(report, ctx.config.parsed.ci.fail_on)
    if (p.json) p.data(report)
    else printSummary(p, report, code)
    return code
  }
  const withCtx = async (
    mode: 'quick' | 'normal' | 'full' | undefined,
    fn: (ctx: EngineContext) => Promise<number> | number,
  ) => {
    const ctx = context(mode)
    try {
      exitCode = await fn(ctx)
    } finally {
      ctx.close()
    }
  }
  const printBaseline = (s: Awaited<ReturnType<typeof runBaseline>>) => {
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
  const printPlan = (s: ReturnType<typeof planRun>) => {
    p.say('cli.plan.summary', { planned: s.planned, possible: s.possible, seed: s.seed })
    if (s.sampled) p.say('cli.plan.sampled', { planned: s.planned, possible: s.possible })
    p.say('cli.plan.estimate', { minutes: (s.estimateMs / 60000).toFixed(1) })
    if (s.warn) p.warn('cli.plan.warn')
  }
  const abortOnSigint = (runId: () => string | null) => {
    const ac = new AbortController()
    const onSig = () => {
      ac.abort()
      const id = runId()
      if (id !== null) p.warn('cli.interrupted', { runId: id })
    }
    process.once('SIGINT', onSig)
    return { signal: ac.signal, dispose: () => process.removeListener('SIGINT', onSig) }
  }
  const fuzzOpts = (o: { maxTime?: string; cache?: boolean }, signal: AbortSignal) => ({
    signal,
    ...(o.cache === false ? { noCache: true } : {}),
    ...(o.maxTime !== undefined ? { maxTimeMs: Number(o.maxTime) * 1000 } : {}),
  })

  program
    .command('init')
    .description(t(locale(), 'cli.cmd.init'))
    .action(() => {
      const existing = findConfigFile(root())
      if (existing !== null) {
        p.warn('cli.init.exists', { path: existing })
        exitCode = EXIT.CONFIG
        return
      }
      const path = join(root(), CONFIG_FILES[0])
      writeFileSync(path, MINIMAL_CONFIG)
      p.say('cli.init.created', { path })
    })

  program
    .command('config')
    .description(t(locale(), 'cli.cmd.config'))
    .option('--check')
    .option('--print')
    .action((o: { check?: boolean; print?: boolean }) => {
      const g = program.opts<GlobalOpts>()
      const cfg = loadConfig(
        root(),
        g.config !== undefined ? { file: resolve(cli.cwd, g.config) } : {},
      )
      if (o.print === true) io.out(printableConfig(cfg).trimEnd())
      else p.say('cli.config.ok', { file: cfg.file ?? t(p.locale, 'cli.config.default') })
    })

  program
    .command('doctor')
    .description(t(locale(), 'cli.cmd.doctor'))
    .action(() =>
      withCtx(undefined, async (ctx) => {
        const r = await doctor(ctx)
        if (p.json) p.data(r)
        else {
          p.say('cli.doctor.runner', {
            adapter: r.adapter,
            version: r.adapterVersion ?? '?',
            node: r.node,
          })
          for (const [name, status] of Object.entries(r.verified))
            p.say('cli.doctor.capability', { name, status })
          for (const reason of r.reasons)
            p.say('cli.doctor.reason', {
              reason: t(p.locale, `doctor.reason.${reason}` as MessageKey),
            })
          p.say('cli.doctor.verdict', { verdict: r.verdict })
        }
        return r.verdict === 'OK'
          ? EXIT.OK
          : r.verdict === 'UNSUPPORTED_PROBE'
            ? EXIT.UNSUPPORTED
            : EXIT.INFRA
      }),
    )

  program
    .command('baseline')
    .description(t(locale(), 'cli.cmd.baseline'))
    .option('--allow-failing')
    .option('--quick')
    .option('--full')
    .action((o: { allowFailing?: boolean; quick?: boolean; full?: boolean }) =>
      withCtx(modeOf(o), async (ctx) => {
        const s = await runBaseline(ctx, { allowFailing: o.allowFailing === true })
        if (p.json) p.data(s)
        else printBaseline(s)
        return s.state === 'BASELINE_FAILED' ? EXIT.BASELINE : EXIT.OK
      }),
    )

  program
    .command('plan')
    .description(t(locale(), 'cli.cmd.plan'))
    .option('--changed [base]')
    .option('--seed <n>')
    .option('--max-mutations <n>')
    .option('--out <file>')
    .option('--quick')
    .option('--full')
    .action(
      (o: {
        seed?: string
        maxMutations?: string
        changed?: string | boolean
        cache?: boolean
        out?: string
        quick?: boolean
        full?: boolean
      }) =>
        withCtx(modeOf(o), async (ctx) => {
          const base =
            ctx.reader.latestRun(ctx.projectId, ['BASELINE_DONE', 'BASELINE_PARTIAL', 'PLANNED']) ??
            (await runBaseline(ctx).then((s) => ctx.reader.getRun(s.runId)))
          if (base === null) throw new VariaError('PROJECT_FAILURE', t(p.locale, 'cli.noRun'))
          const s = planRun(ctx, base.id, {
            ...(o.seed !== undefined ? { seed: Number(o.seed) } : {}),
            ...(o.maxMutations !== undefined ? { maxMutations: Number(o.maxMutations) } : {}),
            ...(o.changed !== undefined
              ? { changed: typeof o.changed === 'string' ? o.changed : 'HEAD' }
              : {}),
          })
          if (o.out !== undefined) {
            copyFileSync(s.planPath, resolve(cli.cwd, o.out))
            p.say('cli.plan.written', { path: resolve(cli.cwd, o.out) })
          }
          if (p.json) p.data(s)
          else printPlan(s)
          return EXIT.OK
        }),
    )

  program
    .command('fuzz')
    .description(t(locale(), 'cli.cmd.fuzz'))
    .option('--no-cache')
    .option('--resume <runId>')
    .option('--plan <file>')
    .option('--max-time <seconds>')
    .option('--force')
    .action((o: { resume?: string; plan?: string; maxTime?: string; force?: boolean }) =>
      withCtx(undefined, async (ctx) => {
        let runId: string | null = o.resume ?? null
        const sig = abortOnSigint(() => runId)
        try {
          if (runId !== null) {
            p.say('cli.fuzz.resume', { done: ctx.reader.resultIds(runId).size })
          } else {
            let base = ctx.reader.latestRun(ctx.projectId, [
              'BASELINE_DONE',
              'BASELINE_PARTIAL',
              'PLANNED',
            ])
            if (base === null)
              base = ctx.reader.getRun((await runBaseline(ctx, { force: o.force === true })).runId)
            if (base === null) throw new VariaError('PROJECT_FAILURE', t(p.locale, 'cli.noRun'))
            runId = base.id
            if (o.plan !== undefined)
              printPlan(savePlan(ctx, runId, readPlan(resolve(cli.cwd, o.plan))))
            else if (base.state !== 'PLANNED') printPlan(planRun(ctx, runId))
          }
          const s = await runFuzz(ctx, runId, fuzzOpts(o, sig.signal))
          if (s.partial) p.warn('cli.fuzz.partial', { pending: s.pending })
          const code = finishRun(ctx, runId)
          return s.aborted ? EXIT.INTERRUPTED : code
        } finally {
          sig.dispose()
        }
      }),
    )

  program
    .command('test')
    .description(t(locale(), 'cli.cmd.test'))
    .option('--no-cache')
    .option('--changed [base]')
    .option('--seed <n>')
    .option('--max-mutations <n>')
    .option('--max-time <seconds>')
    .option('--quick')
    .option('--full')
    .option('--force')
    .action(
      (o: {
        seed?: string
        maxMutations?: string
        changed?: string | boolean
        cache?: boolean
        maxTime?: string
        quick?: boolean
        full?: boolean
        force?: boolean
      }) =>
        withCtx(modeOf(o), async (ctx) => {
          let runId: string | null = null
          const sig = abortOnSigint(() => runId)
          try {
            const b = await runBaseline(ctx, { force: o.force === true })
            runId = b.runId
            printBaseline(b)
            printPlan(
              planRun(ctx, runId, {
                ...(o.seed !== undefined ? { seed: Number(o.seed) } : {}),
                ...(o.maxMutations !== undefined ? { maxMutations: Number(o.maxMutations) } : {}),
                ...(o.changed !== undefined
                  ? { changed: typeof o.changed === 'string' ? o.changed : 'HEAD' }
                  : {}),
              }),
            )
            const s = await runFuzz(ctx, runId, fuzzOpts(o, sig.signal))
            if (s.partial) p.warn('cli.fuzz.partial', { pending: s.pending })
            const code = finishRun(ctx, runId)
            return s.aborted ? EXIT.INTERRUPTED : code
          } finally {
            sig.dispose()
          }
        }),
    )

  program
    .command('replay <mutationId>')
    .description(t(locale(), 'cli.cmd.replay'))
    .action((id: string) =>
      withCtx(undefined, async (ctx) => {
        const r = await replayMutation(ctx, id)
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

  const writeOutputs = (
    ctx: EngineContext,
    runId: string,
    o: { json?: string; junit?: string; sarif?: string; markdown?: string; html?: string },
  ) => {
    const report = buildReport(ctx.reader, runId)
    const env = cli.env
    const outputs: [string | undefined, () => string][] = [
      [o.json, () => JSON.stringify(report, null, 2) + '\n'],
      [o.junit, () => toJUnit(report, ctx.config.parsed.ci.fail_on)],
      [o.sarif, () => toSarif(report)],
      [o.markdown, () => toMarkdown(report, p.locale)],
      [o.html, () => toHtml(report, p.locale, orqeaUrl(env))],
    ]
    for (const [file, render] of outputs) {
      if (file === undefined) continue
      writeFileSync(resolve(cli.cwd, file), render())
      p.say('cli.ci.written', { path: resolve(cli.cwd, file) })
    }
    return report
  }

  program
    .command('report [runId]')
    .description(t(locale(), 'cli.cmd.report'))
    .option('--out <file>')
    .option('--html <file>')
    .option('--junit <file>')
    .option('--sarif <file>')
    .option('--markdown <file>')
    .action(
      (
        runIdArg: string | undefined,
        o: { out?: string; html?: string; junit?: string; sarif?: string; markdown?: string },
      ) =>
        withCtx(undefined, (ctx) => {
          const runId = runIdArg ?? ctx.reader.latestRun(ctx.projectId)?.id
          if (runId === undefined) throw new VariaError('PROJECT_FAILURE', t(p.locale, 'cli.noRun'))
          const report = reportSchema.parse(buildReport(ctx.reader, runId))
          const { out: _o, ...formats } = o
          void _o
          if (Object.keys(formats).length > 0) {
            writeOutputs(ctx, runId, formats)
            return EXIT.OK
          }
          if (o.out !== undefined)
            writeFileSync(resolve(cli.cwd, o.out), JSON.stringify(report, null, 2) + '\n')
          else io.out(JSON.stringify(report, null, 2))
          return EXIT.OK
        }),
    )

  program
    .command('ci')
    .description(t(locale(), 'cli.cmd.ci'))
    .option('--no-cache')
    .option('--changed [base]')
    .option('--json-out <file>')
    .option('--junit <file>')
    .option('--sarif <file>')
    .option('--markdown <file>')
    .option('--html <file>')
    .option('--seed <n>')
    .option('--max-mutations <n>')
    .option('--quick')
    .option('--full')
    .action(
      (o: {
        jsonOut?: string
        junit?: string
        sarif?: string
        markdown?: string
        html?: string
        seed?: string
        maxMutations?: string
        changed?: string | boolean
        cache?: boolean
        quick?: boolean
        full?: boolean
      }) =>
        withCtx(modeOf(o), async (ctx) => {
          const b = await runBaseline(ctx)
          planRun(ctx, b.runId, {
            ...(o.seed !== undefined ? { seed: Number(o.seed) } : {}),
            ...(o.maxMutations !== undefined ? { maxMutations: Number(o.maxMutations) } : {}),
            ...(o.changed !== undefined
              ? { changed: typeof o.changed === 'string' ? o.changed : 'HEAD' }
              : {}),
          })
          await runFuzz(ctx, b.runId, o.cache === false ? { noCache: true } : {})
          const report = writeOutputs(ctx, b.runId, {
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
                  r.gitBranch === ci.fail_on_new_only_against,
              )
            if (ref === undefined)
              p.warn('cli.ci.noReference', { branch: ci.fail_on_new_only_against })
            else {
              p.say('cli.ci.against', { run: ref.id, branch: ci.fail_on_new_only_against })
              reference = new Set(
                ctx.reader
                  .issues(ref.id)
                  .filter((i) => i.count > 0)
                  .map((i) => i.id),
              )
            }
          }
          if (cli.env['GITHUB_ACTIONS'] === 'true')
            for (const line of githubAnnotations(report)) io.out(line)
          const verdict = ciVerdict(report, {
            failOn: ci.fail_on,
            failOnRegression: ci.fail_on_regression,
            reference,
            includeTransitive: ci.include_transitive,
          })
          p.say('cli.ci.verdict', {
            verdict: verdict.fail ? 'FAIL' : 'PASS',
            reasons: verdict.reasons.length === 0 ? '—' : verdict.reasons.slice(0, 5).join(', '),
          })
          return verdict.fail ? EXIT.RESILIENCE : EXIT.OK
        }),
    )

  program
    .command('accept <issueId>')
    .description(t(locale(), 'cli.cmd.accept'))
    .requiredOption('--reason <text>')
    .option('--owner <name>')
    .option('--expires <date>')
    .action((issueId: string, o: { reason: string; owner?: string; expires?: string }) =>
      withCtx(undefined, (ctx) => {
        const issue = ctx.reader.issue(issueId)
        const occ = ctx.reader
          .issueHistory(issueId)
          .filter((h) => h.count > 0)
          .at(-1)
        if (issue === null || occ === undefined)
          throw new VariaError('PROJECT_FAILURE', `issue inconnue : ${issueId}`)
        const muts = occ.mutationIds
          .map((id) => ctx.reader.mutation(occ.runId, id))
          .filter((m): m is Record<string, unknown> => m !== null)
        const same = (k: string) =>
          muts.length > 0 && muts.every((m) => m[k] === muts[0]?.[k]) ? String(muts[0]?.[k]) : null
        const a = {
          id: `a_${randomBytes(5).toString('hex')}`,
          projectId: ctx.projectId,
          function: issue.target,
          path: same('pathStr'),
          strategy: same('strategy'),
          reason: o.reason,
          owner: o.owner ?? null,
          expires: o.expires ?? null,
        }
        ctx.writer.addAcceptance(a)
        p.say('cli.accept.done', {
          id: a.id,
          function: a.function,
          path: a.path ?? '*',
          strategy: a.strategy ?? '*',
          reason: a.reason,
        })
        return EXIT.OK
      }),
    )

  program
    .command('compare <a> <b>')
    .description(t(locale(), 'cli.cmd.compare'))
    .action((a: string, b: string) =>
      withCtx(undefined, (ctx) => {
        for (const id of [a, b]) {
          if (ctx.reader.getRun(id) === null)
            throw new VariaError('PROJECT_FAILURE', `run inconnu : ${id}`)
        }
        const counts = (id: string) =>
          ctx.reader
            .issues(id)
            .filter((i) => i.count > 0)
            .map((i) => ({ id: i.id, target: i.target, count: i.count }))
        const d = diffIssues(counts(a), counts(b))
        if (p.json) p.data({ a, b, ...d })
        else {
          p.say('cli.compare.head', { a, b })
          for (const id of d.added) p.say('cli.compare.added', { id })
          for (const id of d.removed) p.say('cli.compare.removed', { id })
          for (const c of d.changed)
            p.say('cli.compare.changed', { id: c.id, before: c.before, after: c.after })
          p.say('cli.compare.summary', {
            added: d.added.length,
            removed: d.removed.length,
            changed: d.changed.length,
            unchanged: d.unchanged.length,
          })
        }
        return EXIT.OK
      }),
    )

  program
    .command('clean')
    .description(t(locale(), 'cli.cmd.clean'))
    .action(() =>
      withCtx(undefined, (ctx) => {
        const tmp = join(ctx.dataDir, 'tmp')
        if (existsSync(tmp)) {
          rmSync(tmp, { recursive: true, force: true })
          p.say('cli.clean.done', { path: tmp })
        }
        return EXIT.OK
      }),
    )

  program
    .command('dashboard')
    .description(t(locale(), 'cli.cmd.dashboard'))
    .addOption(new Option('--port <port>').default('4321'))
    .action(async (o: { port: string }) => {
      if (cli.startDashboard === undefined) return
      const ctx = context()
      const dataDir = ctx.dataDir
      ctx.close()
      const server = await cli.startDashboard({ dataDir, port: Number(o.port), env: cli.env })
      p.say('cli.dashboard.listening', { url: server.url })
      await new Promise<void>((done) =>
        process.once('SIGINT', () => void server.close().then(done)),
      )
    })

  try {
    await program.parseAsync(['node', 'varia', ...argv])
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode === 0 ? EXIT.OK : EXIT.CONFIG
    if (e instanceof VariaError || e instanceof ConfigError) {
      const kind = e instanceof VariaError ? e.kind : 'CONFIG_FAILURE'
      p.warn('cli.error', { kind, message: t(p.locale, `err.${kind}` as MessageKey) })
      const details = e instanceof VariaError ? e.details : e.issues
      for (const d of details.slice(0, 20)) p.warn('cli.error.detail', { detail: d })
      return e instanceof VariaError ? e.exitCode : EXIT.CONFIG
    }
    p.warn('cli.error', {
      kind: 'VARIA_INTERNAL_FAILURE',
      message: t(p.locale, 'err.VARIA_INTERNAL_FAILURE'),
    })
    p.warn('cli.error.detail', { detail: (e as Error).stack ?? String(e) })
    return EXIT.INFRA
  }
  return exitCode
}
