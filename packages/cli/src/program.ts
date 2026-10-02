import { ConfigError } from '@varia/config'
import { EngineContext, EXIT, VARIA_VERSION, VariaError } from '@varia/engine'
import { configIssue, resolveLocale, t, type Locale, type MessageKey } from '@varia/i18n'
import { Command, CommanderError } from 'commander'
import { resolve } from 'node:path'
import { registerAdmin } from './commands/admin.js'
import { registerResults } from './commands/results.js'
import { registerRun } from './commands/run.js'
import { printer, type Io, type Printer } from './io.js'
import {
  adapterFor,
  progress,
  type CliEnv,
  type GlobalOpts,
  type Mode,
  type Shared,
} from './shared.js'

export { acceptanceYaml, adapterFor, frameworkOfCommand, type CliEnv } from './shared.js'

/** Point d'entrée du CLI (`bin/varia`), testable : arguments, sorties et environnement injectés. */
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
    // Conserver les fichiers temporaires (journaux de la sonde, déjà redigés) : diagnostic (§10.6).
    .option('--keep-tmp')
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
  const context = (mode?: Mode) => {
    const o = program.opts<GlobalOpts>()
    return new EngineContext({
      root: root(),
      adapter:
        cli.adapter?.(root()) ??
        adapterFor(root(), o.config !== undefined ? resolve(cli.cwd, o.config) : undefined),
      ...(o.dataDir !== undefined ? { dataDir: resolve(cli.cwd, o.dataDir) } : {}),
      ...(o.config !== undefined ? { configFile: resolve(cli.cwd, o.config) } : {}),
      ...(mode !== undefined ? { mode } : {}),
      keepTmp: o.keepTmp === true,
      onProgress: progress(() => p),
    })
  }
  const shared: Shared = {
    program,
    io,
    cli,
    p: () => p,
    locale,
    root,
    path: (x) => resolve(cli.cwd, x),
    context,
    withCtx: async (mode, fn) => {
      const ctx = context(mode)
      try {
        exitCode = await fn(ctx)
      } finally {
        ctx.close()
      }
    },
    setExit: (code) => {
      exitCode = code
    },
  }
  registerAdmin(shared)
  registerRun(shared)
  registerResults(shared)

  try {
    await program.parseAsync(['node', 'varia', ...argv])
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode === 0 ? EXIT.OK : EXIT.CONFIG
    if (e instanceof VariaError || e instanceof ConfigError) {
      const kind = e instanceof VariaError ? e.kind : 'CONFIG_FAILURE'
      p.warn('cli.error', { kind, message: t(p.locale, `err.${kind}` as MessageKey) })
      const details = e instanceof VariaError ? e.details : e.issues
      for (const d of details.slice(0, 20))
        p.warn('cli.error.detail', { detail: configIssue(p.locale, d) })
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
