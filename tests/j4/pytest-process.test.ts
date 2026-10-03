// R-02 : scénarios d'acceptation du §5 (J4) sur examples/pytest-project, par le MOTEUR et l'adaptateur
// pytest réels. (6) boucle infinie ⇒ TIMEOUT, arbre tué, la mutation suivante s'exécute ; (7) sortie
// de processus (os._exit, sys.exit) ⇒ CRASH ; (11) aucune valeur sensible brute sur disque (keepTmp) ;
// (13) doctor : capacités vérifiées, UNSUPPORTED_PROBE quand l'injection est impossible ; (14) reprise
// après arrêt brutal sans rejouer une mutation déjà enregistrée.
import { PytestAdapter } from '@varia/adapter-pytest'
import { mutationId, type PlannedMutation } from '@varia/core'
import {
  doctor,
  EngineContext,
  planRun,
  readPlan,
  runBaseline,
  runFuzz,
  savePlan,
} from '@varia/engine'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PYTEST = resolve('examples/pytest-project')

// Ajv 8 (dialecte 2020-12), déjà présent via Fastify, comme tests/j4/probe-logs.test.ts.
const fastifyRequire = createRequire(createRequire(import.meta.url).resolve('fastify'))
const ajvRequire = createRequire(fastifyRequire.resolve('@fastify/ajv-compiler'))
const Ajv2020 = (
  ajvRequire('ajv/dist/2020') as {
    default: new (o: object) => {
      compile(s: object): ((v: unknown) => boolean) & { errors?: unknown }
    }
  }
).default
const ajv = new Ajv2020({ strict: true, allErrors: true })
const schema = (type: string) =>
  JSON.parse(
    readFileSync(
      resolve(
        'packages/probe-protocol/schema',
        `${type.toLowerCase().replace(/_/g, '-')}.schema.json`,
      ),
      'utf8',
    ),
  ) as object
const union = ajv.compile(schema('PROBE_MESSAGE'))
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p))
const context = (root: string, o: { keepTmp?: boolean; configFile?: string } = {}) =>
  new EngineContext({ root, adapter: new PytestAdapter(), dataDir: tmp('varia-pytest-'), ...o })

describe('pytest (6) (7) : boucle infinie et sortie de processus', () => {
  it('TIMEOUT, puis CRASH (os._exit, sys.exit), puis une mutation ordinaire : toutes exécutées', async () => {
    const ctx = context(PYTEST)
    try {
      const b = await runBaseline(ctx)
      const all = readPlan(planRun(ctx, b.runId).planPath)
      const pick = (exp: string, value: unknown, path?: string): PlannedMutation => {
        const m = all.mutations.find(
          (x) =>
            x.export === exp &&
            (path === undefined || x.pathStr === path) &&
            x.op === 'set' &&
            JSON.stringify(x.value) === JSON.stringify(value),
        )
        if (m === undefined) throw new Error(`absente : ${exp}`)
        return m
      }
      const boom = pick('exit_on', 'boom')
      // Seconde valeur déclarée, écartée par l'échantillonnage du plan : même call site, valeur « quit ».
      const quit = {
        ...boom,
        id: mutationId(boom.callSiteId, boom.pathStr, boom.strategy, 'set', 'quit'),
        value: 'quit',
      }
      const ordered = [pick('repeat', null), boom, quit, pick('create_user', null, 'arg0.name')]
      savePlan(ctx, b.runId, { ...all, possible: ordered.length, mutations: ordered })
      await runFuzz(ctx, b.runId)
      const res = new Map(ctx.reader.results(b.runId).map((r) => [r.mutationId, r]))
      expect(ordered.map((m) => [res.get(m.id)?.status, res.get(m.id)?.subtype ?? null])).toEqual([
        ['TIMEOUT', null],
        ['CRASH', 'PROCESS_EXIT'],
        // sys.exit lève SystemExit : levée synchrone, hors des erreurs gérées ⇒ échec inattendu.
        ['UNEXPECTED_FAILURE', null],
        ['HANDLED', null],
      ])
      if (process.platform !== 'win32') {
        const ps = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' })
        expect(ps.split('\n').filter((l) => l.includes(b.runId))).toEqual([])
      }
    } finally {
      ctx.close()
    }
  })
})

describe('pytest (11) : aucune valeur sensible brute sur disque', () => {
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
  it('journaux conservés (keepTmp), rapports pytest, base : aucun secret brut', async () => {
    const ctx = context(PYTEST, { keepTmp: true })
    try {
      const b = await runBaseline(ctx)
      planRun(ctx, b.runId, { maxMutations: 12, filters: { functions: ['create_user'] } })
      await runFuzz(ctx, b.runId)
      const all = files(ctx.dataDir)
      const logs = all
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n')
      expect(logs).toContain('"export":"create_user"')
      // Chaque ligne écrite par la sonde Python est valide contre les JSON Schema publiés (P-01).
      const invalid = logs
        .split('\n')
        .filter((l) => l !== '')
        .filter((l) => {
          const msg = JSON.parse(l) as { type: string }
          return !union(msg) || !ajv.compile(schema(msg.type))(msg)
        })
      expect(invalid).toEqual([])
      expect(logs).toMatch(/"password":\{"\$redacted"/)
      expect(all.some((f) => f.endsWith('pytest-report.json'))).toBe(true)
      const leaks = all.flatMap((f) => {
        const c = readFileSync(f).toString('latin1')
        return SECRETS.filter((s) => c.includes(s)).map((s) => `${s} dans ${f}`)
      })
      expect(leaks).toEqual([])
    } finally {
      ctx.close()
    }
  })
})

/** Projet pytest jetable hors du dépôt (environnement virtuel de l'exemple, lié). */
function project(files: Record<string, string>): string {
  const root = tmp('varia-pytest-proj-')
  symlinkSync(join(PYTEST, '.venv'), join(root, '.venv'), 'junction')
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    writeFileSync(join(root, f), c)
  }
  return root
}
const CONFIG = "version: 1\ntargets: { mode: auto, include: ['src/**'] }\n"

describe('pytest (13) : doctor', () => {
  it('exemple : capacités déclarées vérifiées par test de fumée, le reste dit avec sa raison', async () => {
    const ctx = context(PYTEST)
    try {
      const d = await doctor(ctx)
      expect([d.adapter, d.verdict]).toEqual(['pytest', 'OK'])
      expect(d.verified).toEqual({
        observation: 'VERIFIED',
        argumentMutation: 'VERIFIED',
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
    } finally {
      ctx.close()
    }
  })
  it('cibles chargées hors du système d’import (exec) : injection impossible ⇒ UNSUPPORTED_PROBE', async () => {
    const root = project({
      'varia.yml': CONFIG,
      'pyproject.toml': '[tool.pytest.ini_options]\npythonpath = ["."]\n',
      'src/greet.py': 'def greet(u):\n    return "Hello " + u["name"]\n',
      // Le module est exécuté par exec, sans import : aucun crochet sys.meta_path ne le voit.
      'tests/test_greet.py': [
        'import pathlib',
        'ns = {}',
        'exec(pathlib.Path(__file__).parent.parent.joinpath("src/greet.py").read_text(), ns)',
        'def test_greet():',
        '    assert ns["greet"]({"name": "Ada"}) == "Hello Ada"',
        '',
      ].join('\n'),
    })
    const ctx = context(root)
    try {
      const d = await doctor(ctx)
      expect([d.adapter, d.verdict, d.reasons]).toEqual([
        'pytest',
        'UNSUPPORTED_PROBE',
        ['NO_TARGET_MODULE_WRAPPED'],
      ])
    } finally {
      ctx.close()
    }
  })
  it('sans pytest (aucun interpréteur avec pytest) ⇒ RUNNER_NOT_FOUND', async () => {
    const root = tmp('varia-pytest-vide-')
    writeFileSync(join(root, 'varia.yml'), CONFIG)
    const ctx = new EngineContext({
      root,
      adapter: new PytestAdapter(() => {
        throw new Error('No module named pytest')
      }),
      dataDir: tmp('varia-pytest-'),
    })
    try {
      expect((await doctor(ctx)).verdict).toBe('RUNNER_NOT_FOUND')
    } finally {
      ctx.close()
    }
  })
})

describe('pytest (14) : reprise après arrêt', () => {
  it('une seconde invocation de runFuzz ne rejoue aucune mutation déjà persistée', async () => {
    const cfg = join(tmp('varia-cfg-'), 'varia.yml')
    writeFileSync(
      cfg,
      [
        'version: 1',
        "targets: { mode: auto, include: ['src/users.py'] }",
        'mutations: { mode: normal, seed: 42 }',
        'execution: { timeout_ms: 30000 }',
        'oracle: { handled_errors: [{ name: ValidationError }], slow_floor_ms: 3600000 }',
      ].join('\n'),
    )
    const ctx = context(PYTEST, { configFile: cfg })
    try {
      const b = await runBaseline(ctx)
      planRun(ctx, b.runId, { maxMutations: 8 })
      // Arrêt au milieu (signal d'arrêt après 3 résultats, comme Ctrl+C / processus tué).
      const stop = new AbortController()
      const timer = setInterval(() => {
        if (ctx.reader.resultIds(b.runId).size >= 3) stop.abort()
      }, 20)
      const first = await runFuzz(ctx, b.runId, { signal: stop.signal }).finally(() =>
        clearInterval(timer),
      )
      expect(first.partial).toBe(true)
      const before = ctx.reader.resultIds(b.runId)
      expect(before.size).toBeLessThan(8)
      await runFuzz(ctx, b.runId)
      const second = ctx.reader
        .events(b.runId, 'MUTATION_STARTED')
        .map((e) => e.data as { mutationId: string; invocation: string })
        .filter((e) => e.invocation === '2')
        .map((e) => e.mutationId)
      for (const id of before) expect(second).not.toContain(id)
      expect(second.length).toBe(8 - before.size)
      expect(ctx.reader.resultIds(b.runId).size).toBe(8)
    } finally {
      ctx.close()
    }
  })
})
