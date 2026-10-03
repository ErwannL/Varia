// X-01 : scénarios d'acceptation du §5 (J4) sur examples/custom-project (lanceur factice runner.cjs),
// via le MOTEUR réel. (6) boucle infinie ⇒ TIMEOUT, arbre tué, la mutation suivante s'exécute ;
// (7) sortie de processus ⇒ CRASH ; (11) aucune valeur sensible brute sur disque (keepTmp) ;
// (13) doctor vérifie les capacités DÉCLARÉES, UNSUPPORTED_PROBE quand le lanceur ne fait pas la sonde ;
// (14) reprise après arrêt brutal sans rejouer une mutation déjà enregistrée.
import { CustomAdapter } from '@varia/adapter-custom'
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
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CUSTOM = resolve('examples/custom-project')
const newDir = (p: string) => mkdtempSync(join(tmpdir(), p))
const context = (root = CUSTOM, o: { keepTmp?: boolean; configFile?: string } = {}) =>
  new EngineContext({
    root,
    adapter: CustomAdapter.fromConfig(root, o.configFile),
    dataDir: newDir('varia-j4-custom-'),
    ...o,
  })

describe('custom (6) (7) : boucle infinie et sortie de processus', () => {
  it('TIMEOUT, puis CRASH / PROCESS_EXIT, puis une mutation ordinaire : toutes exécutées, aucun survivant', async () => {
    const ctx = context()
    try {
      const b = await runBaseline(ctx)
      const all = readPlan(planRun(ctx, b.runId).planPath)
      const pick = (exp: string, value: unknown, path?: string) => {
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
      const ordered = [
        pick('repeat', null),
        pick('exitOn', 'boom'),
        pick('createUser', null, 'arg0.name'),
      ]
      savePlan(ctx, b.runId, { ...all, mutations: ordered })
      const s = await runFuzz(ctx, b.runId)
      expect(s.executed).toBe(3)
      const status = (id: string) => ctx.reader.results(b.runId).find((r) => r.mutationId === id)
      expect(ordered.map((m) => [status(m.id)?.status, status(m.id)?.subtype])).toEqual([
        ['TIMEOUT', null],
        ['CRASH', 'PROCESS_EXIT'],
        ['HANDLED', null],
      ])
      if (process.platform !== 'win32') {
        // Aucun processus (superviseur, lanceur) portant l'identifiant du run ne survit.
        const ps = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' })
        expect(ps.split('\n').filter((l) => l.includes(b.runId))).toEqual([])
      }
    } finally {
      ctx.close()
    }
  })
})

describe('custom (11) : aucune valeur sensible brute sur disque', () => {
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
  it('journaux de sonde et résultats conservés (keepTmp), base, plans : aucun secret brut', async () => {
    const ctx = context(CUSTOM, { keepTmp: true })
    try {
      const b = await runBaseline(ctx)
      planRun(ctx, b.runId, { maxMutations: 12, filters: { functions: ['createUser'] } })
      await runFuzz(ctx, b.runId)
    } finally {
      ctx.close()
    }
    const all = files(ctx.dataDir)
    const jsonl = all.filter((f) => f.endsWith('.jsonl'))
    expect(jsonl.length).toBeGreaterThan(0)
    const logs = jsonl.map((f) => readFileSync(f, 'utf8')).join('\n')
    expect(logs).toContain('"export":"createUser"')
    expect(logs).toMatch(/"password":\{"\$redacted"/)
    expect(all.some((f) => f.endsWith('results.json'))).toBe(true)
    const leaks = all.flatMap((f) => {
      const c = readFileSync(f).toString('latin1')
      return SECRETS.filter((s) => c.includes(s)).map((s) => `${s} dans ${f}`)
    })
    expect(leaks).toEqual([])
  })
})

/** Projet jetable : fichiers donnés, configuration custom avec les capacités et la commande données. */
function project(files: Record<string, string>): string {
  const root = newDir('varia-custom-proj-')
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    writeFileSync(join(root, f), c)
  }
  return root
}
const ALL_DECLARED =
  '{ observation: true, argumentMutation: true, perTestSelection: true, asyncTargets: true, esm: true, cjs: true, mocks: true, testParameters: true, coverage: true, isolatedProcess: true, parallelSafe: true }'
const config = (command: string, extra = '') =>
  [
    'version: 1',
    'test:',
    '  framework: custom',
    '  custom:',
    `    command: ${command}`,
    `    capabilities: ${ALL_DECLARED}`,
    extra,
    "targets: { mode: auto, include: ['src/**'] }",
  ].join('\n')
/** Lanceur qui rend des résultats verts mais n'implémente PAS la sonde (aucun journal JSONL). */
const LIAR = `require('node:fs').writeFileSync(process.env.VARIA_RESULTS, JSON.stringify({ tests: [{ file: 'tests/a.test.js', name: 'a', status: 'passed', durationMs: 1 }] }))\n`

describe('custom (13) : doctor vérifie les capacités déclarées', () => {
  it('exemple : capacités déclarées vérifiées par test de fumée, le reste dit avec sa raison', async () => {
    const ctx = context()
    try {
      const d = await doctor(ctx)
      expect([d.adapter, d.adapterVersion, d.verdict]).toEqual(['custom', '1.0.0', 'OK'])
      expect(d.verified).toEqual({
        observation: 'VERIFIED',
        argumentMutation: 'VERIFIED',
        perTestSelection: 'VERIFIED',
        asyncTargets: 'VERIFIED',
        esm: 'UNSUPPORTED',
        cjs: 'VERIFIED',
        mocks: 'UNSUPPORTED',
        testParameters: 'NOT_VERIFIED',
        coverage: 'UNSUPPORTED',
        isolatedProcess: 'VERIFIED',
        parallelSafe: 'UNSUPPORTED',
      })
      expect(d.checks.testParameters).toEqual({ status: 'NOT_VERIFIED', reason: 'NO_SMOKE_TEST' })
      expect(d.checks.esm).toEqual({ status: 'UNSUPPORTED', reason: 'NOT_DECLARED' })
    } finally {
      ctx.close()
    }
  })
  it('lanceur qui déclare tout sans faire la sonde : jamais cru, UNSUPPORTED_PROBE (code 5 au CLI)', async () => {
    const root = project({
      'package.json': '{}',
      'liar.cjs': LIAR,
      'src/a.js': 'module.exports = { a: () => 1 }\n',
      'varia.yml': config("['node', 'liar.cjs']"),
    })
    const ctx = context(root)
    try {
      const d = await doctor(ctx)
      expect([d.verdict, d.reasons]).toEqual(['UNSUPPORTED_PROBE', ['NO_TARGET_MODULE_WRAPPED']])
      expect(d.checks.observation).toEqual({
        status: 'UNSUPPORTED',
        reason: 'NO_TARGET_MODULE_WRAPPED',
      })
      expect(d.checks.coverage).toEqual({ status: 'NOT_VERIFIED', reason: 'COVERAGE_NOT_PRODUCED' })
      expect(Object.values(d.verified).includes('VERIFIED')).toBe(false)
    } finally {
      ctx.close()
    }
  })
  it('sonde d’une majeure inconnue ⇒ UNSUPPORTED_PROBE / PROBE_PROTOCOL_UNSUPPORTED', async () => {
    const hello = `{"protocolVersion":2,"runId":"r","type":"HELLO","testId":null,"timestamp":"t","mode":"observe","pid":1,"mutationId":null}`
    const root = project({
      'package.json': '{}',
      'future.cjs': `require('node:fs').writeFileSync(require('node:path').join(process.env.VARIA_RUN_DIR, 'probe-1.jsonl'), '${hello}\\n')\n${LIAR}`,
      'src/a.js': 'module.exports = { a: () => 1 }\n',
      'varia.yml': config("['node', 'future.cjs']"),
    })
    const ctx = context(root)
    try {
      const d = await doctor(ctx)
      expect([d.verdict, d.reasons]).toEqual(['UNSUPPORTED_PROBE', ['PROBE_PROTOCOL_UNSUPPORTED']])
    } finally {
      ctx.close()
    }
  })
  it('commande de découverte en échec ⇒ RUNNER_NOT_FOUND, rien de vérifié', async () => {
    const root = project({
      'package.json': '{}',
      'src/a.js': 'module.exports = { a: () => 1 }\n',
      'varia.yml': config("['node', 'absent.cjs']", "    discover: ['node', 'absent.cjs']"),
    })
    const ctx = context(root)
    try {
      const d = await doctor(ctx)
      expect([d.verdict, d.detected, d.reasons]).toEqual([
        'RUNNER_NOT_FOUND',
        false,
        ['RUNNER_NOT_FOUND'],
      ])
    } finally {
      ctx.close()
    }
  })
})

describe('custom (14) : reprise après arrêt brutal du processus Varia', () => {
  it('runFuzz relancé ne rejoue aucune mutation déjà persistée', async () => {
    const dataDir = newDir('varia-j4-custom-')
    // Cibles qui ne bouclent ni ne quittent : la durée ne dépend que du nombre de mutations.
    const cfg = join(newDir('varia-cfg-'), 'varia.yml')
    writeFileSync(
      cfg,
      [
        'version: 1',
        'project: { name: custom-project }',
        "test: { framework: custom, custom: { command: ['node', 'runner.cjs'] } }",
        "targets: { mode: auto, include: ['src/users.js'] }",
        'mutations: { mode: normal, seed: 42 }',
        'execution: { timeout_ms: 30000 }',
        'oracle: { handled_errors: [{ name: ValidationError }], slow_floor_ms: 3600000 }',
      ].join('\n'),
    )
    const open = () =>
      new EngineContext({
        root: CUSTOM,
        adapter: CustomAdapter.fromConfig(CUSTOM, cfg),
        dataDir,
        configFile: cfg,
      })
    const first = open()
    const b = await runBaseline(first)
    planRun(first, b.runId, { maxMutations: 12 })
    const dbPath = join(first.dataDir, 'varia.db')
    first.close()
    const child = spawn(
      process.execPath,
      [
        resolve('node_modules/tsx/dist/cli.mjs'),
        resolve('tests/j4/custom-fuzz-child.ts'),
        CUSTOM,
        dataDir,
        cfg,
        b.runId,
      ],
      { cwd: resolve('.'), stdio: 'ignore' },
    )
    const persisted = await new Promise<Set<string>>((done, fail) => {
      const started = Date.now()
      const timer = setInterval(() => {
        let ids = new Set<string>()
        try {
          const o = openReader(dbPath)
          ids = new Reader(o.db).resultIds(b.runId)
          o.close()
        } catch {
          // Base pas encore ouverte par l'enfant : on réessaie.
        }
        if (ids.size >= 3) {
          clearInterval(timer)
          child.kill('SIGKILL')
          done(ids)
        } else if (Date.now() - started > 120_000) {
          clearInterval(timer)
          child.kill('SIGKILL')
          fail(new Error('aucun résultat persisté'))
        }
      }, 50)
    })
    await new Promise((r) => child.once('exit', r))
    const ctx = open()
    try {
      const before = ctx.reader.resultIds(b.runId)
      expect(before.size).toBeGreaterThanOrEqual(persisted.size)
      expect(before.size).toBeLessThan(12)
      await runFuzz(ctx, b.runId)
      const second = ctx.reader
        .events(b.runId, 'MUTATION_STARTED')
        .map((e) => e.data as { mutationId: string; invocation: string })
        .filter((e) => e.invocation === '2')
        .map((e) => e.mutationId)
      for (const id of before) expect(second, id).not.toContain(id)
      expect(second.length).toBe(12 - before.size)
      expect(ctx.reader.resultIds(b.runId).size).toBe(12)
      expect(ctx.reader.getRun(b.runId)?.state).toBe('COMPLETED')
    } finally {
      ctx.close()
    }
  })
})
