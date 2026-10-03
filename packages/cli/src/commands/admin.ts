// Commandes d'administration : init, config, doctor, clean, prune, db, list, version, dashboard.
import { CONFIG_FILES, findConfigFile, loadConfig, printableConfig } from '@varia/config'
import { STRATEGY_IDS } from '@varia/core'
import { checkDatabase, backupDatabase } from '@varia/database'
import { doctor, EXIT, pruneRuns, VARIA_VERSION, VariaError } from '@varia/engine'
import { configIssue, t, type MessageKey } from '@varia/i18n'
import { Option } from 'commander'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Shared } from '../shared.js'

const MINIMAL_CONFIG =
  'version: 1\ntargets: { mode: auto, include: ["src/**"] }\nmutations: { mode: normal }\noracle:\n  handled_errors: [{ name: ValidationError }]\n'

export const ADAPTERS = ['jest', 'vitest'] as const

export function registerAdmin(s: Shared): void {
  const { program } = s

  program
    .command('init')
    .description(t(s.locale(), 'cli.cmd.init'))
    .action(() => {
      const existing = findConfigFile(s.root())
      if (existing !== null) {
        s.p().warn('cli.init.exists', { path: existing })
        s.setExit(EXIT.CONFIG)
        return
      }
      const path = join(s.root(), CONFIG_FILES[0])
      writeFileSync(path, MINIMAL_CONFIG)
      s.p().say('cli.init.created', { path })
    })

  program
    .command('config')
    .description(t(s.locale(), 'cli.cmd.config'))
    .option('--check')
    .option('--print')
    .action((o: { check?: boolean; print?: boolean }) => {
      const g = s.program.opts<{ config?: string }>()
      const cfg = loadConfig(s.root(), g.config !== undefined ? { file: s.path(g.config) } : {})
      const p = s.p()
      // Clés inconnues : avertissement, la configuration reste valide (B-05).
      for (const w of cfg.warnings)
        p.warn('cli.warning.config', { detail: configIssue(p.locale, w) })
      if (o.print === true) s.io.out(printableConfig(cfg).trimEnd())
      else p.say('cli.config.ok', { file: cfg.file ?? t(p.locale, 'cli.config.default') })
    })

  program
    .command('doctor')
    .description(t(s.locale(), 'cli.cmd.doctor'))
    .action(() =>
      s.withCtx(undefined, async (ctx) => {
        const r = await doctor(ctx)
        const p = s.p()
        if (p.json) p.data(r)
        else {
          p.say('cli.doctor.runner', {
            adapter: r.adapter,
            version: r.adapterVersion ?? '?',
            node: r.node,
          })
          for (const [name, status] of Object.entries(r.verified)) {
            const reason = r.checks[name as keyof typeof r.checks].reason
            if (reason === null) p.say('cli.doctor.capability', { name, status })
            else
              p.say('cli.doctor.capabilityReason', {
                name,
                status,
                reason: t(p.locale, `report.capReason.${reason}` as MessageKey),
              })
          }
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
    .command('clean')
    .description(t(s.locale(), 'cli.cmd.clean'))
    .action(() =>
      s.withCtx(undefined, (ctx) => {
        const tmp = join(ctx.dataDir, 'tmp')
        if (existsSync(tmp)) {
          rmSync(tmp, { recursive: true, force: true })
          s.p().say('cli.clean.done', { path: tmp })
        }
        return EXIT.OK
      }),
    )

  program
    .command('prune')
    .description(t(s.locale(), 'cli.cmd.prune'))
    .option('--keep <n>')
    .action((o: { keep?: string }) =>
      s.withCtx(undefined, (ctx) => {
        const keep =
          o.keep !== undefined ? Number(o.keep) : ctx.config.parsed.storage.retention_runs
        if (!Number.isInteger(keep) || keep < 0)
          throw new VariaError('CONFIG_FAILURE', '--keep doit être un entier ≥ 0', [String(o.keep)])
        const removed = pruneRuns(ctx, keep)
        const p = s.p()
        if (p.json) p.data({ keep, removed })
        else
          p.say('cli.prune.done', { count: removed.length, keep, runs: removed.join(', ') || '—' })
        return EXIT.OK
      }),
    )

  const db = program.command('db').description(t(s.locale(), 'cli.cmd.db'))
  db.command('check')
    .description(t(s.locale(), 'cli.cmd.dbCheck'))
    .action(() =>
      s.withCtx(undefined, (ctx) => {
        const problems = checkDatabase(ctx.db.sqlite)
        const ok = problems.length === 1 && problems[0] === 'ok'
        const p = s.p()
        if (p.json) p.data({ ok, problems })
        else if (ok) p.say('cli.db.ok', { path: join(ctx.dataDir, 'varia.db') })
        else for (const problem of problems) p.warn('cli.db.problem', { problem })
        return ok ? EXIT.OK : EXIT.INFRA
      }),
    )
  db.command('backup')
    .description(t(s.locale(), 'cli.cmd.dbBackup'))
    .option('--out <file>')
    .action((o: { out?: string }) =>
      s.withCtx(undefined, async (ctx) => {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const dest =
          o.out !== undefined ? s.path(o.out) : join(ctx.dataDir, 'backups', `varia-${stamp}.db`)
        await backupDatabase(ctx.db.sqlite, dest)
        s.p().say('cli.db.backup', { path: dest })
        return EXIT.OK
      }),
    )

  program
    .command('list <what>')
    .description(t(s.locale(), 'cli.cmd.list'))
    .action((what: string) => {
      const p = s.p()
      const items =
        what === 'adapters'
          ? ADAPTERS.map((id) => ({
              id,
              description: t(p.locale, `cli.list.adapter.${id}` as MessageKey),
            }))
          : what === 'strategies'
            ? STRATEGY_IDS.map((id) => ({
                id,
                description: t(p.locale, `cli.list.strategy.${id}` as MessageKey),
              }))
            : null
      if (items === null)
        throw new VariaError('CONFIG_FAILURE', 'list adapters | strategies', [what])
      if (p.json) p.data(items)
      else for (const i of items) s.io.out(`${i.id} — ${i.description}`)
    })

  program
    .command('version')
    .description(t(s.locale(), 'cli.cmd.version'))
    .action(() => {
      const p = s.p()
      const v = {
        varia: VARIA_VERSION,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
      }
      if (p.json) p.data(v)
      else s.io.out(VARIA_VERSION)
    })

  program
    .command('dashboard')
    .description(t(s.locale(), 'cli.cmd.dashboard'))
    .addOption(new Option('--port <port>').default('4321'))
    .action(async (o: { port: string }) => {
      if (s.cli.startDashboard === undefined) return
      const ctx = s.context()
      const dataDir = ctx.dataDir
      ctx.close()
      const server = await s.cli.startDashboard({ dataDir, port: Number(o.port), env: s.cli.env })
      s.p().say('cli.dashboard.listening', { url: server.url })
      await new Promise<void>((done) =>
        process.once('SIGINT', () => void server.close().then(done)),
      )
    })
}
