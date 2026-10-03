import type {
  AdapterCapabilities,
  AdapterRun,
  AdapterRunOptions,
  DetectResult,
  PrepareContext,
  TestAdapter,
} from '@varia/core'
import { globToRegExpSource, runSupervised, statusFileIn } from '@varia/core'
import { parseProbeLog, PROBE_ENV, type ProbeEvent } from '@varia/probe-protocol'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectorsFor } from './ids.js'
import { parseEventsReport } from './report.js'

/** Dossier de construction de la sonde Java (jar de l'agent + `lib/` : console JUnit). */
export const AGENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'agent', 'target')

/** Capacités DÉCLARÉES de l'adaptateur JUnit (R-04) ; `varia doctor` les vérifie sur le projet. */
export const JUNIT_CAPABILITIES: AdapterCapabilities = {
  observation: true,
  argumentMutation: true,
  perTestSelection: true,
  // Cibles rendant une CompletableFuture : issue asynchrone observée (TARGET_RETURN async / REJECT).
  asyncTargets: true,
  // Notions JavaScript (systèmes de modules) : sans objet pour Java, jamais déclarées.
  esm: false,
  cjs: false,
  mocks: false,
  testParameters: true,
  coverage: false,
  isolatedProcess: true,
  parallelSafe: false,
}

/** Résultat d'une commande de préparation (Maven, javac). */
export interface ExecResult {
  status: number | null
  stdout: string
  stderr: string
}
export type Exec = (cmd: string, args: string[], cwd: string) => ExecResult

/** Commandes réelles ; sous Windows, `mvn` est un script `.cmd` (shell requis). */
export function spawnExec(platform: NodeJS.Platform = process.platform): Exec {
  return (cmd, args, cwd) => {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: platform === 'win32' })
    // Commande introuvable : ni sortie ni code, seulement `error`.
    return { status: r.status, stdout: r.stdout ?? '', stderr: String(r.stderr ?? r.error) }
  }
}

/** Dépendances fournies par la console JUnit (jamais en double sur le chemin de classes). */
const LAUNCHER_PROVIDED = /[\\/]org[\\/](junit|opentest4j|apiguardian)[\\/]/

/** Racines déclarées dans le `pom.xml` (`<sourceDirectory>`, `<testSourceDirectory>`), sinon Maven. */
export function sourceRoots(pom: string): { main: string; test: string } {
  const tag = (t: string) => new RegExp(`<${t}>\\s*([^<]+?)\\s*</${t}>`).exec(pom)?.[1]
  const clean = (p: string) => p.replace(/^\$\{(project\.)?basedir\}\//, '')
  return {
    main: clean(tag('sourceDirectory') ?? 'src/main/java'),
    test: clean(tag('testSourceDirectory') ?? 'src/test/java'),
  }
}

/** Fichiers `.java` d'un dossier (récursif, triés), chemins absolus. */
export function javaFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .sort()
    .flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? javaFiles(p) : n.endsWith('.java') ? [p] : []
    })
}

/**
 * Classes ciblées : fichiers sources principaux retenus par `targets.include` / `exclude` (globs sur le
 * chemin relatif au projet) → nom qualifié de la classe de premier niveau → module.
 */
export function targetClasses(
  root: string,
  mainRoot: string,
  include: string[],
  exclude: string[],
): Record<string, string> {
  const inc = include.map((g) => new RegExp(`^${globToRegExpSource(g)}$`))
  const exc = exclude.map((g) => new RegExp(`^${globToRegExpSource(g)}$`))
  const out: Record<string, string> = {}
  for (const abs of javaFiles(join(root, mainRoot))) {
    const rel = relative(root, abs).split(sep).join('/')
    if (!inc.some((r) => r.test(rel)) || exc.some((r) => r.test(rel))) continue
    const fqcn = relative(join(root, mainRoot), abs)
      .split(sep)
      .join('.')
      .replace(/\.java$/, '')
    out[fqcn] = rel
  }
  return out
}

export interface JUnitAdapterOptions {
  /** Dossier contenant `varia-junit-agent.jar` et `lib/junit-platform-console-standalone.jar`. */
  agentDir?: string
  exec?: Exec
  java?: string
  mvn?: string
}

export class JUnitAdapter implements TestAdapter {
  readonly id = 'junit'
  private ctx: PrepareContext | null = null
  private classpath = ''
  private testRoots: string[] = []
  private readonly agentDir: string
  private readonly exec: Exec
  private readonly java: string
  private readonly mvn: string

  constructor(o: JUnitAdapterOptions = {}) {
    this.agentDir = o.agentDir ?? AGENT_DIR
    this.exec = o.exec ?? spawnExec()
    this.java = o.java ?? 'java'
    this.mvn = o.mvn ?? 'mvn'
  }

  capabilities(): AdapterCapabilities {
    return { ...JUNIT_CAPABILITIES }
  }

  async detect(root: string): Promise<DetectResult> {
    const pom = join(root, 'pom.xml')
    const text = existsSync(pom) ? readFileSync(pom, 'utf8') : ''
    const dep = /<artifactId>junit-jupiter[\w-]*<\/artifactId>\s*<version>([^<]+)<\/version>/.exec(
      text,
    )
    const version = dep?.[1] ?? null
    return {
      detected: version !== null,
      framework: 'junit',
      version,
      nativeEsm: false,
      reasons: version === null ? ['RUNNER_NOT_FOUND'] : [],
    }
  }

  private run1(cmd: string, args: string[], cwd: string, code: string): string {
    const r = this.exec(cmd, args, cwd)
    if (r.status !== 0)
      throw new Error(`${code}: ${cmd} ${args[0] ?? ''}\n${r.stderr}${r.stdout}`.trim())
    return r.stdout
  }

  /**
   * Préparation HORS du projet : chemin de classes résolu par Maven HORS LIGNE (`-o` : aucun réseau),
   * compilation par javac dans le dossier temporaire du run, configuration de l'agent.
   */
  async prepare(ctx: PrepareContext): Promise<void> {
    this.ctx = ctx
    const jar = join(this.agentDir, 'varia-junit-agent.jar')
    if (!existsSync(jar)) throw new Error(`JUNIT_AGENT_NOT_BUILT: ${jar}`)
    const roots = sourceRoots(readFileSync(join(ctx.root, 'pom.xml'), 'utf8'))
    this.testRoots = [roots.test]
    const cpFile = join(ctx.tmpDir, 'maven-classpath.txt')
    this.run1(
      this.mvn,
      [
        '-o',
        '-q',
        'dependency:build-classpath',
        '-Dmdep.includeScope=test',
        `-Dmdep.outputFile=${cpFile}`,
      ],
      ctx.root,
      'MAVEN_CLASSPATH_FAILED',
    )
    const deps = readFileSync(cpFile, 'utf8')
      .trim()
      .split(delimiter)
      .filter((p) => p !== '' && !LAUNCHER_PROVIDED.test(p))
    const classes = join(ctx.tmpDir, 'classes')
    const testClasses = join(ctx.tmpDir, 'test-classes')
    mkdirSync(classes, { recursive: true })
    mkdirSync(testClasses, { recursive: true })
    const compile = (out: string, cp: string[], files: string[]) => {
      if (files.length > 0)
        this.run1(
          'javac',
          [
            '-d',
            out,
            '-encoding',
            'UTF-8',
            '-cp',
            [...cp, ...deps, this.launcher()].join(delimiter),
            ...files,
          ],
          ctx.root,
          'JAVAC_FAILED',
        )
    }
    compile(classes, [], javaFiles(join(ctx.root, roots.main)))
    compile(testClasses, [classes], javaFiles(join(ctx.root, roots.test)))
    const resources = ['src/main/resources', 'src/test/resources']
      .map((r) => join(ctx.root, r))
      .filter((r) => existsSync(r))
    this.classpath = [classes, testClasses, ...resources, ...deps].join(delimiter)
    writeFileSync(
      join(ctx.tmpDir, 'junit-agent.json'),
      JSON.stringify({
        classes: targetClasses(ctx.root, roots.main, ctx.include, ctx.exclude),
        testRoots: this.testRoots,
        opaqueTypes: [],
      }),
    )
    writeFileSync(
      join(ctx.tmpDir, 'targets.json'),
      JSON.stringify({ runId: ctx.runId, projectRoot: ctx.root }),
    )
    writeFileSync(join(ctx.tmpDir, 'redact.json'), JSON.stringify(ctx.redact), { mode: 0o600 })
  }

  private launcher(): string {
    return join(this.agentDir, 'lib', 'junit-platform-console-standalone.jar')
  }

  async run(o: AdapterRunOptions): Promise<AdapterRun> {
    const ctx = this.ctx
    if (ctx === null) throw new Error('JUnitAdapter.prepare() doit être appelé avant run()')
    const reports = join(o.runDir, 'junit-reports')
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const k of Object.keys(env)) if (k.startsWith('VARIA_')) Reflect.deleteProperty(env, k)
    Object.assign(env, ctx.env ?? {}, o.env ?? {}, {
      [PROBE_ENV.mode]: o.mode,
      [PROBE_ENV.runDir]: o.runDir,
      [PROBE_ENV.targets]: join(ctx.tmpDir, 'targets.json'),
      [PROBE_ENV.redact]: join(ctx.tmpDir, 'redact.json'),
      ...(o.planPath !== undefined ? { [PROBE_ENV.plan]: o.planPath } : {}),
      ...(o.mutationId !== undefined ? { [PROBE_ENV.mutationId]: o.mutationId } : {}),
    })
    const selection =
      o.testName !== undefined
        ? selectorsFor(o.testName)
        : [`--scan-classpath=${join(ctx.tmpDir, 'test-classes')}`]
    const args = [
      ...(ctx.memoryMb !== undefined ? [`-Xmx${String(ctx.memoryMb)}m`] : []),
      `-javaagent:${join(this.agentDir, 'varia-junit-agent.jar')}=${join(ctx.tmpDir, 'junit-agent.json')}`,
      '-jar',
      this.launcher(),
      'execute',
      '--disable-banner',
      '--disable-ansi-colors',
      '--details=none',
      `--class-path=${this.classpath}`,
      `--reports-dir=${reports}`,
      '--config=junit.platform.reporting.open.xml.enabled=true',
      `--config=junit.platform.reporting.output.dir=${reports}`,
      ...selection,
    ]
    const proc = await runSupervised(this.java, args, {
      cwd: ctx.cwd ?? ctx.root,
      env,
      timeoutMs: o.timeoutMs,
      statusFile: statusFileIn(o.runDir),
      ...(o.maxOutputBytes !== undefined ? { maxOutputBytes: o.maxOutputBytes } : {}),
    })
    const events: ProbeEvent[] = []
    let truncatedLines = 0
    let invalidLines = 0
    for (const f of readdirSync(o.runDir)
      .filter((n) => /^probe-\d+\.jsonl$/.test(n))
      .sort()) {
      const parsed = parseProbeLog(readFileSync(join(o.runDir, f), 'utf8'))
      events.push(...parsed.events)
      truncatedLines += parsed.truncatedLines
      invalidLines += parsed.invalidLines
    }
    const report = existsSync(reports)
      ? readdirSync(reports).find((n) => /^junit-platform-events-.*\.xml$/.test(n))
      : undefined
    const tests =
      proc.timedOut || report === undefined
        ? null
        : parseEventsReport(readFileSync(join(reports, report), 'utf8'), ctx.root, this.testRoots)
    return { process: proc, tests, events, truncatedLines, invalidLines }
  }
}
