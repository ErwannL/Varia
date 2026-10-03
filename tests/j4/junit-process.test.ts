// R-04 : scénarios d'acceptation du §5 (J4) sur examples/junit-project, adaptateur JUnit RÉEL + moteur.
// (6) boucle infinie ⇒ TIMEOUT, arbre tué, la mutation suivante s'exécute ; (7) System.exit ⇒ CRASH ;
// (11) aucune valeur sensible brute sur disque (dossiers temporaires conservés) ; (13) doctor :
// capacités vérifiées, UNSUPPORTED_PROBE quand aucune classe cible n'est instrumentée ; (14) reprise
// après arrêt brutal (SIGKILL) du processus Varia.
import { JUnitAdapter } from '@varia/adapter-junit'
import type { PlannedMutation } from '@varia/core'
import { mutationId } from '@varia/core'
import { openReader, Reader } from '@varia/database'
import {
  doctor,
  EngineContext,
  planRun,
  readPlan,
  runBaseline,
  runFuzz,
  savePlan,
} from '@varia/engine'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const JUNIT = resolve('examples/junit-project')

// Ajv 8 (dialecte 2020-12), déjà présent via Fastify (même validateur indépendant que probe-logs).
const fastifyRequire = createRequire(createRequire(import.meta.url).resolve('fastify'))
const ajvRequire = createRequire(fastifyRequire.resolve('@fastify/ajv-compiler'))
const Ajv2020 = (
  ajvRequire('ajv/dist/2020') as {
    default: new (o: object) => {
      compile(s: object): ((v: unknown) => boolean) & { errors?: unknown }
    }
  }
).default
const union = new Ajv2020({ strict: true, allErrors: true }).compile(
  JSON.parse(
    readFileSync(resolve('packages/probe-protocol/schema/probe-message.schema.json'), 'utf8'),
  ) as object,
)
const newDir = (p: string) => mkdtempSync(join(tmpdir(), `varia-junit-${p}-`))
const context = (
  o: { root?: string; keepTmp?: boolean; configFile?: string; dataDir?: string } = {},
) =>
  new EngineContext({
    root: o.root ?? JUNIT,
    adapter: new JUnitAdapter(),
    dataDir: o.dataDir ?? newDir('data'),
    ...(o.keepTmp === true ? { keepTmp: true } : {}),
    ...(o.configFile !== undefined ? { configFile: o.configFile } : {}),
  })
const planOf = (m: PlannedMutation[]) => ({
  schemaVersion: 1,
  variaVersion: '0.1.0',
  seed: 1,
  gitCommit: null,
  configHash: '',
  possible: m.length,
  mutations: m,
})

describe('JUnit (6) (7) : boucle infinie et sortie de processus', () => {
  it('TIMEOUT, puis CRASH / PROCESS_EXIT, puis une mutation ordinaire : toutes exécutées, aucun survivant', async () => {
    const ctx = context()
    try {
      const b = await runBaseline(ctx)
      const all = readPlan(planRun(ctx, b.runId, {}).planPath).mutations
      const find = (exp: string, path: string, value?: unknown) => {
        const m = all.find(
          (x) =>
            x.export === exp &&
            x.pathStr === path &&
            (value === undefined || JSON.stringify(x.value) === JSON.stringify(value)),
        )
        if (m === undefined) throw new Error(`absente : ${exp}`)
        return m
      }
      // `count` NaN : la boucle `while (n != 0) n -= 1` ne termine jamais.
      const r = find('repeat', 'arg1')
      const nan = { $t: 'number', v: 'NaN' }
      const loop: PlannedMutation = {
        ...r,
        id: mutationId(r.callSiteId, r.pathStr, 'boundary', 'set', nan),
        op: 'set',
        strategy: 'boundary',
        value: nan,
      }
      const ordered = [loop, find('exitOn', 'arg0', 'boom'), find('createUser', 'arg0.name', null)]
      savePlan(ctx, b.runId, planOf(ordered))
      await runFuzz(ctx, b.runId)
      const res = ctx.reader.results(b.runId)
      const status = (id: string) => res.find((x) => x.mutationId === id)
      expect(ordered.map((m) => [status(m.id)?.status, status(m.id)?.subtype])).toEqual([
        ['TIMEOUT', null],
        ['CRASH', 'PROCESS_EXIT'],
        ['HANDLED', null],
      ])
      if (process.platform !== 'win32') {
        // Aucun processus (superviseur, JVM) portant l'identifiant du run ne survit.
        const ps = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' })
        expect(ps.split('\n').filter((l) => l.includes(b.runId))).toEqual([])
      }
    } finally {
      ctx.close()
    }
  }, 600_000)
})

describe('JUnit (11) : aucune valeur sensible brute sur disque', () => {
  const SECRETS = [
    'hunter2-secret',
    'pw-ada-secret',
    'pw-grace-secret',
    'pw-linus-secret',
    'pw-each-secret',
  ]
  const files = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f)
      return statSync(p).isDirectory() ? files(p) : [p]
    })
  it('journaux et rapports conservés (keepTmp), configuration générée, base : aucun secret brut', async () => {
    const D = newDir('keep')
    const ctx = context({ keepTmp: true, dataDir: D })
    try {
      const b = await runBaseline(ctx)
      planRun(ctx, b.runId, { maxMutations: 12, filters: { functions: ['createUser'] } })
      await runFuzz(ctx, b.runId)
    } finally {
      ctx.close()
    }
    const all = files(D)
    const jsonl = all.filter((f) => f.endsWith('.jsonl'))
    expect(jsonl.length).toBeGreaterThan(0)
    const logs = jsonl.map((f) => readFileSync(f, 'utf8')).join('\n')
    expect(logs).toContain('"export":"createUser"')
    expect(logs).toMatch(/"password":\{"\$redacted"/)
    // P-01 : chaque ligne écrite par la sonde Java est valide contre le JSON Schema publié.
    const lines = logs.split('\n').filter((l) => l !== '')
    const types = new Set(lines.map((l) => (JSON.parse(l) as { type: string }).type))
    expect(lines.filter((l) => !union(JSON.parse(l)))).toEqual([])
    for (const t of [
      'HELLO',
      'DISCOVER',
      'TEST_START',
      'TEST_END',
      'OBSERVE_CALL',
      'MUTATE_CALL',
      'TARGET_RETURN',
      'TARGET_THROW',
    ])
      expect(types.has(t), t).toBe(true)
    expect(all.some((f) => /junit-platform-events-.*\.xml$/.test(f))).toBe(true)
    // Les classes compilées des tests du projet (`*.class`) contiennent ses propres littéraux : ce sont
    // des copies de son code source, pas des valeurs observées ; tout le reste est relu.
    const leaks = all
      .filter((f) => !f.endsWith('.class'))
      .flatMap((f) => {
        const c = readFileSync(f).toString('latin1')
        return SECRETS.filter((s) => c.includes(s)).map((s) => `${s} dans ${f}`)
      })
    expect(leaks).toEqual([])
    expect(all.some((f) => f.endsWith('.class'))).toBe(true)
  }, 600_000)
})

/** Projet Maven jetable hors du dépôt (pom de l'exemple), fichiers donnés. */
function project(files: Record<string, string>): string {
  const root = newDir('proj')
  copyFileSync(join(JUNIT, 'pom.xml'), join(root, 'pom.xml'))
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    writeFileSync(join(root, f), c)
  }
  return root
}

describe('JUnit (13) : doctor', () => {
  it('exemple : capacités déclarées vérifiées par test de fumée, le reste dit avec sa raison', async () => {
    const ctx = context()
    try {
      const d = await doctor(ctx)
      expect([d.adapter, d.verdict, d.adapterVersion]).toEqual(['junit', 'OK', '5.11.4'])
      expect(d.verified).toEqual({
        observation: 'VERIFIED',
        // Le test de fumée du moteur mute la PREMIÈRE entrée du catalogue avec `null` : ici le
        // paramètre `double count` de repeat ; Java ne peut pas recevoir null (jamais forcé).
        argumentMutation: 'NOT_VERIFIED',
        perTestSelection: 'VERIFIED',
        asyncTargets: 'VERIFIED',
        esm: 'UNSUPPORTED',
        cjs: 'UNSUPPORTED',
        mocks: 'UNSUPPORTED',
        testParameters: 'NOT_VERIFIED',
        coverage: 'UNSUPPORTED',
        isolatedProcess: 'VERIFIED',
        parallelSafe: 'UNSUPPORTED',
      })
      expect(d.checks.argumentMutation).toEqual({
        status: 'NOT_VERIFIED',
        reason: 'MUTATION_NOT_APPLIED',
      })
      expect(d.checks.testParameters).toEqual({ status: 'NOT_VERIFIED', reason: 'NO_SMOKE_TEST' })
      expect(d.checks.cjs).toEqual({ status: 'UNSUPPORTED', reason: 'NOT_DECLARED' })
    } finally {
      ctx.close()
    }
  }, 600_000)
  it('aucune classe cible instrumentée (cibles jamais chargées) ⇒ UNSUPPORTED_PROBE', async () => {
    const root = project({
      'varia.yml': "version: 1\ntargets: { mode: auto, include: ['src/main/java/**'] }\n",
      'src/main/java/demo/Greet.java':
        'package demo;\npublic final class Greet {\n  public static String hi(String n) {\n    return "Hello " + n;\n  }\n}\n',
      // Le test n'utilise pas la classe cible : l'agent n'a rien à instrumenter.
      'src/test/java/demo/GreetTest.java':
        'package demo;\nimport org.junit.jupiter.api.Test;\nclass GreetTest {\n  @Test\n  void ok() {}\n}\n',
    })
    const ctx = context({ root })
    try {
      const d = await doctor(ctx)
      expect([d.verdict, d.reasons]).toEqual(['UNSUPPORTED_PROBE', ['NO_TARGET_MODULE_WRAPPED']])
      expect(d.checks.observation).toEqual({
        status: 'UNSUPPORTED',
        reason: 'NO_TARGET_MODULE_WRAPPED',
      })
    } finally {
      ctx.close()
    }
  }, 600_000)
})

describe('JUnit (14) : reprise après arrêt brutal du processus Varia', () => {
  it('runFuzz relancé ne rejoue aucune mutation déjà persistée', async () => {
    const D = newDir('resume')
    // Cibles qui ne bouclent ni ne quittent : la durée ne dépend que du nombre de mutations.
    const cfg = join(newDir('cfg'), 'varia.yml')
    writeFileSync(
      cfg,
      [
        'version: 1',
        'project: { name: junit-project }',
        "targets: { mode: auto, include: ['src/main/java/com/example/Users.java'] }",
        'mutations: { mode: normal, seed: 42 }',
        'execution: { timeout_ms: 30000 }',
        'oracle: { handled_errors: [{ name: ValidationException }], slow_floor_ms: 3600000 }',
      ].join('\n'),
    )
    const ctx = context({ dataDir: D, configFile: cfg })
    const b = await runBaseline(ctx)
    const runId = b.runId
    planRun(ctx, runId, { maxMutations: 8 })
    ctx.close()
    // Processus Varia séparé (tsx + chemins du dépôt), tué par SIGKILL après 2 résultats persistés.
    const script = join(newDir('child'), 'fuzz.mts')
    writeFileSync(
      script,
      [
        "import { JUnitAdapter } from '@varia/adapter-junit'",
        "import { EngineContext, runFuzz } from '@varia/engine'",
        `const ctx = new EngineContext({ root: ${JSON.stringify(JUNIT)}, adapter: new JUnitAdapter(), dataDir: ${JSON.stringify(D)}, configFile: ${JSON.stringify(cfg)} })`,
        `await runFuzz(ctx, ${JSON.stringify(runId)})`,
        '',
      ].join('\n'),
    )
    const tsx = resolve('node_modules/.bin/tsx')
    const child = spawn(tsx, ['--tsconfig', resolve('tsconfig.json'), script], { stdio: 'ignore' })
    const persisted = await new Promise<Set<string>>((done, fail) => {
      const started = Date.now()
      const timer = setInterval(() => {
        const file = findDb(D)
        let ids = new Set<string>()
        try {
          if (file === null) throw new Error('base absente')
          const o = openReader(file)
          ids = new Reader(o.db).resultIds(runId)
          o.close()
        } catch {
          // Base pas encore lisible : on réessaie.
        }
        if (ids.size >= 2) {
          clearInterval(timer)
          child.kill('SIGKILL')
          done(ids)
        } else if (Date.now() - started > 300_000) {
          clearInterval(timer)
          child.kill('SIGKILL')
          fail(new Error('aucun résultat persisté'))
        }
      }, 100)
    })
    await new Promise((r) => child.once('exit', r))
    const again = context({ dataDir: D, configFile: cfg })
    try {
      const first = again.reader.resultIds(runId)
      expect(first.size).toBeGreaterThanOrEqual(persisted.size)
      expect(first.size).toBeLessThan(8)
      await runFuzz(again, runId)
      const second = again.reader
        .events(runId, 'MUTATION_STARTED')
        .map((e) => e.data as { mutationId: string; invocation: string })
        .filter((e) => e.invocation === '2')
        .map((e) => e.mutationId)
      for (const id of first) expect(second, id).not.toContain(id)
      expect(second.length).toBe(8 - first.size)
      expect(again.reader.resultIds(runId).size).toBe(8)
      expect(again.reader.getRun(runId)?.state).toBe('COMPLETED')
    } finally {
      again.close()
    }
  }, 900_000)
})

/** Base SQLite du projet dans le dossier de données (sous `projects/<nom>-<empreinte>/`). */
function findDb(d: string): string | null {
  const hit = readdirSync(d, { recursive: true, encoding: 'utf8' }).find((f) =>
    f.endsWith('varia.db'),
  )
  return hit === undefined ? null : join(d, hit)
}
