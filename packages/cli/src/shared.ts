import { CustomAdapter } from '@varia/adapter-custom'
import { JestAdapter } from '@varia/adapter-jest'
import { MochaAdapter } from '@varia/adapter-mocha'
import { PhpunitAdapter } from '@varia/adapter-phpunit'
import { JUnitAdapter } from '@varia/adapter-junit'
import { PytestAdapter } from '@varia/adapter-pytest'
import { VitestAdapter } from '@varia/adapter-vitest'
import { CONFIG_FILES, loadConfig } from '@varia/config'
import type { TestAdapter } from '@varia/core'
import {
  EngineContext,
  runFuzz,
  VariaError,
  type PlanFilters,
  type ProgressEvent,
} from '@varia/engine'
import { configIssue, type Locale, type MessageKey } from '@varia/i18n'
import { buildReport } from '@varia/reporters'
import { Option, type Command } from 'commander'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Io, Printer } from './io.js'
import { printSummary, resilienceExit } from './summary.js'

/** Entrée `acceptances.items` à ajouter à `varia.yml` (magasin fichier, CDC §21). */
export function acceptanceYaml(a: {
  function: string
  path: string | null
  strategy: string | null
  reason: string
  owner: string | null
  expires: string | null
}): string {
  const pattern = {
    function: a.function,
    ...(a.path !== null ? { path: a.path } : {}),
    ...(a.strategy !== null ? { strategy: a.strategy } : {}),
  }
  const item = {
    mutation_pattern: pattern,
    reason: a.reason,
    ...(a.owner !== null ? { owner: a.owner } : {}),
    ...(a.expires !== null ? { expires: a.expires } : {}),
  }
  return `- ${JSON.stringify(item)}`
}

/** Fichier de configuration du projet (`varia.yml` à la racine quand il n'existe pas encore). */
export const configFileOf = (ctx: EngineContext): string =>
  ctx.config.file ?? join(ctx.root, CONFIG_FILES[0])

/** Framework désigné par une commande de test (`npx vitest run` → vitest, `jest --ci` → jest). */
export function frameworkOfCommand(
  command: string | undefined,
): 'jest' | 'vitest' | 'mocha' | undefined {
  if (command === undefined) return undefined
  if (/\bvitest\b/.test(command)) return 'vitest'
  if (/\bmocha\b/.test(command)) return 'mocha'
  return /\bjest\b/.test(command) ? 'jest' : undefined
}

/** Choix de l'adapter (le moteur n'en connaît aucun) : `test.framework`, sinon détection par dépendances. */
export function adapterFor(root: string, configFile?: string): TestAdapter {
  let framework: string | undefined
  try {
    const test = loadConfig(root, configFile !== undefined ? { file: configFile } : {}).parsed.test
    // `test.command` n'est pas exécutée (Varia lance le runner lui-même pour injecter la sonde, §5) :
    // elle sert à reconnaître le framework quand `test.framework` est absent.
    framework = test.framework ?? frameworkOfCommand(test.command)
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
    // Jest reste le défaut ; Vitest ou Mocha seulement s'il est le seul lanceur connu des dépendances.
    framework =
      'jest' in deps ? 'jest' : 'vitest' in deps ? 'vitest' : 'mocha' in deps ? 'mocha' : 'jest'
  }
  if (framework === 'custom') return CustomAdapter.fromConfig(root, configFile)
  if (framework === 'pytest') return new PytestAdapter()
  if (framework === 'phpunit') return new PhpunitAdapter()
  if (framework === 'junit') return new JUnitAdapter()
  if (framework === 'vitest') return new VitestAdapter()
  return framework === 'mocha' ? new MochaAdapter() : new JestAdapter()
}

export interface CliEnv {
  env: NodeJS.ProcessEnv
  cwd: string
  /** Adapter imposé (tests du CLI) ; par défaut choisi par `adapterFor`. */
  adapter?: (root: string) => TestAdapter
  /** Démarre le dashboard (injecté pour garder le CLI indépendant de l'API dans les tests). */
  startDashboard?: (o: {
    dataDir: string
    port: number
    host: string
    env: NodeJS.ProcessEnv
    /** `--allow-run` : de quoi relancer Varia depuis le tableau de bord. */
    run?: DashboardRun
  }) => Promise<{ url: string; close(): Promise<void> }>
  /** Commande qui relance ce même Varia (`[node, script]`) ; absente en test. */
  selfCommand?: string[] | undefined
}

/** Ce que le tableau de bord peut lancer (`--allow-run`) : Varia lui-même, dans CE projet. */
export interface DashboardRun {
  command: string[]
  globalArgs: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  info: { name: string; root: string; config: string | null }
}

export interface GlobalOpts {
  dataDir?: string
  lang?: string
  quiet?: boolean
  json?: boolean
  project?: string
  config?: string
  keepTmp?: boolean
}

export type Mode = 'quick' | 'normal' | 'full'

/** Outils communs aux commandes, construits par `runCli`. */
export interface Shared {
  program: Command
  io: Io
  cli: CliEnv
  /** Imprimante courante (langue, --quiet, --json fixés au lancement de la commande). */
  p(): Printer
  locale(): Locale
  root(): string
  /** Chemin d'un argument relatif au répertoire courant. */
  path(p: string): string
  context(mode?: Mode): EngineContext
  /** Exécute `fn` avec un contexte, fixe le code de sortie, ferme le contexte. */
  withCtx(
    mode: Mode | undefined,
    fn: (ctx: EngineContext) => Promise<number> | number,
  ): Promise<void>
  setExit(code: number): void
}

/** Mode demandé (`--quick` et `--full` sont mutuellement exclusifs, refusés ensemble : exit 3). */
export const modeOf = (o: { quick?: boolean; full?: boolean }): Mode | undefined =>
  o.quick === true ? 'quick' : o.full === true ? 'full' : undefined

/** Options `--quick` / `--full`, déclarées en conflit. */
export function modeOptions(cmd: Command): Command {
  return cmd
    .addOption(new Option('--quick').conflicts('full'))
    .addOption(new Option('--full').conflicts('quick'))
}

const collect = (v: string, prev: string[] = []) => [...prev, v]

/** Options de ciblage (CDC §27), répétables : appliquées à la planification. */
export function targetingOptions(cmd: Command): Command {
  return cmd
    .addOption(new Option('--test <name>').argParser(collect))
    .addOption(new Option('--file <path>').argParser(collect))
    .addOption(new Option('--function <name>').argParser(collect))
    .addOption(new Option('--strategy <id>').argParser(collect))
}

export interface TargetingOpts {
  test?: string[]
  file?: string[]
  function?: string[]
  strategy?: string[]
}

export function filtersOf(o: TargetingOpts): PlanFilters | undefined {
  const f: PlanFilters = {
    ...(o.test !== undefined ? { tests: o.test } : {}),
    ...(o.file !== undefined ? { files: o.file } : {}),
    ...(o.function !== undefined ? { functions: o.function } : {}),
    ...(o.strategy !== undefined ? { strategies: o.strategy } : {}),
  }
  return Object.keys(f).length > 0 ? f : undefined
}

/** Progression et avertissements du moteur, traduits. */
export function progress(p: () => Printer) {
  return (e: ProgressEvent) => {
    const pr = p()
    if (e.type === 'baseline')
      pr.say('cli.baseline.run', {
        run: e.run,
        of: e.of,
        passed: e.passed,
        total: e.total,
        seconds: (e.durationMs / 1000).toFixed(1),
      })
    else if (e.type === 'mutation')
      pr.say('cli.fuzz.progress', {
        index: e.index,
        of: e.of,
        id: e.id,
        status: e.subtype !== undefined ? `${e.status}/${e.subtype}` : e.status,
      })
    else if (e.type === 'warning') {
      const [code, ...rest] = e.message.split(':')
      const detail = rest.join(':')
      if (code === 'CONFIG')
        pr.warn('cli.warning.config', { detail: configIssue(pr.locale, detail) })
      else if (code === 'TMP_KEPT') pr.warn('cli.warning.TMP_KEPT', { dir: detail })
      else pr.warn(`cli.warning.${String(code)}` as MessageKey)
    }
  }
}

/** Résumé de fin de run ; rend le code de sortie de la politique (`ci.fail_on`). */
export function finishRun(p: Printer, ctx: EngineContext, runId: string): number {
  const report = buildReport(ctx.reader, runId)
  const code = resilienceExit(report, ctx.config.parsed.ci.fail_on)
  if (p.json) p.data(report)
  else printSummary(p, report, code)
  return code
}

/** Fuzz ; si le projet a été modifié, le résumé du run (marqué PROJECT_MUTATED) est imprimé avant l'erreur. */
export async function fuzzWithSummary(
  p: Printer,
  ctx: EngineContext,
  runId: string,
  opts: Parameters<typeof runFuzz>[2],
) {
  try {
    return await runFuzz(ctx, runId, opts)
  } catch (e) {
    if (e instanceof VariaError && e.kind === 'PROJECT_MUTATED') finishRun(p, ctx, runId)
    throw e
  }
}
