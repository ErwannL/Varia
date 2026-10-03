// R-03 : scénarios d'acceptation du §5 (J4) sur examples/phpunit-project, par le MOTEUR avec l'adapter
// PHPUnit réel. (6) boucle infinie ⇒ TIMEOUT, arbre tué, la mutation suivante s'exécute ; (7) exit() ⇒
// CRASH ; (11) aucune valeur sensible brute sur disque (keepTmp) ; (13) doctor : capacités vérifiées,
// UNSUPPORTED_PROBE quand l'injection est impossible ; (14) reprise après arrêt brutal (SIGKILL).
import { PhpunitAdapter } from '@varia/adapter-phpunit'
import { systemProcesses } from '@varia/adapter-conformance'
import type { PlannedMutation } from '@varia/core'
import { openReader, Reader } from '@varia/database'
import { doctor, EngineContext, planRun, runBaseline, runFuzz, savePlan } from '@varia/engine'
import { spawn } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const PHPUNIT = resolve('examples/phpunit-project')
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p))
const engine = (
  root = PHPUNIT,
  o: { configFile?: string; keepTmp?: boolean; dataDir?: string } = {},
) =>
  new EngineContext({
    root,
    adapter: new PhpunitAdapter(),
    dataDir: o.dataDir ?? tmp('varia-php-data-'),
    ...o,
  })

describe('PHPUnit (6) (7) : boucle infinie et sortie de processus', () => {
  it('TIMEOUT, puis CRASH / PROCESS_EXIT, puis une mutation ordinaire : toutes exécutées, aucun survivant', async () => {
    const ctx = engine()
    try {
      const b = await runBaseline(ctx)
      const all = JSON.parse(readFileSync(planRun(ctx, b.runId, {}).planPath, 'utf8')) as {
        mutations: PlannedMutation[]
      }
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
      savePlan(ctx, b.runId, { ...(all as object), mutations: ordered } as Parameters<
        typeof savePlan
      >[2])
      await runFuzz(ctx, b.runId)
      const res = ctx.reader.results(b.runId)
      const st = (id: string) => res.find((r) => r.mutationId === id)
      expect(ordered.map((m) => [st(m.id)?.status, st(m.id)?.subtype])).toEqual([
        ['TIMEOUT', null],
        ['CRASH', 'PROCESS_EXIT'],
        ['HANDLED', null],
      ])
      // Aucun processus portant l'identifiant du run ne survit (ps, ou PowerShell sous Windows).
      const procs = systemProcesses()
      expect(procs).not.toBeNull()
      expect(procs?.filter((l) => l.includes(b.runId))).toEqual([])
    } finally {
      ctx.close()
    }
  }, 120_000)
})

describe('PHPUnit (11) : aucune valeur sensible brute sur disque', () => {
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
  it('journaux conservés (keepTmp), copies réécrites, résultats, base : aucun secret brut', async () => {
    const D = tmp('varia-php-secrets-')
    const ctx = engine(PHPUNIT, { dataDir: D, keepTmp: true })
    try {
      const b = await runBaseline(ctx)
      planRun(ctx, b.runId, { maxMutations: 12, filters: { functions: ['createUser'] } })
      await runFuzz(ctx, b.runId)
    } finally {
      ctx.close()
    }
    const all = files(D)
    const logs = all
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    expect(logs).toContain('"export":"createUser"')
    expect(logs).toMatch(/"password":\{"\$redacted"/)
    expect(all.some((f) => f.endsWith('phpunit-results.json'))).toBe(true)
    const leaks = all.flatMap((f) => {
      const c = readFileSync(f).toString('latin1')
      return SECRETS.filter((s) => c.includes(s)).map((s) => `${s} dans ${f}`)
    })
    expect(leaks).toEqual([])
  }, 180_000)
})

/** Projet PHPUnit jetable hors du dépôt (vendor/ de l'exemple, lié) : fichiers donnés. */
function project(files: Record<string, string>): string {
  const root = tmp('varia-php-proj-')
  symlinkSync(join(PHPUNIT, 'vendor'), join(root, 'vendor'), 'junction')
  for (const [f, c] of Object.entries({
    'composer.json': readFileSync(join(PHPUNIT, 'composer.json'), 'utf8'),
    'phpunit.xml': readFileSync(join(PHPUNIT, 'phpunit.xml'), 'utf8'),
    ...files,
  })) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    writeFileSync(join(root, f), c)
  }
  return root
}
const GREET =
  '<?php\nnamespace App;\nfinal class Greet\n{\n    public static function greet(array $u): string\n    {\n        return "Hello " . $u["name"];\n    }\n}\n'
const testOf = (load: string) =>
  `<?php\nnamespace App\\Tests;\n${load}\nfinal class GreetTest extends \\PHPUnit\\Framework\\TestCase\n{\n    public function testGreet(): void\n    {\n        $this->assertSame('Hello Ada', \\App\\Greet::greet(['name' => 'Ada']));\n    }\n}\n`

describe('PHPUnit (13) : doctor', () => {
  it('exemple : capacités déclarées vérifiées par test de fumée, le reste dit avec sa raison', async () => {
    const ctx = engine()
    try {
      const d = await doctor(ctx)
      expect([d.adapter, d.verdict, d.adapterVersion]).toEqual(['phpunit', 'OK', '11.5.2'])
      expect(d.verified).toEqual({
        observation: 'VERIFIED',
        argumentMutation: 'VERIFIED',
        perTestSelection: 'VERIFIED',
        asyncTargets: 'UNSUPPORTED',
        esm: 'UNSUPPORTED',
        cjs: 'UNSUPPORTED',
        mocks: 'UNSUPPORTED',
        testParameters: 'NOT_VERIFIED',
        coverage: 'UNSUPPORTED',
        isolatedProcess: 'VERIFIED',
        parallelSafe: 'UNSUPPORTED',
      })
      expect(d.checks.asyncTargets).toEqual({ status: 'UNSUPPORTED', reason: 'NOT_DECLARED' })
    } finally {
      ctx.close()
    }
  }, 120_000)
  it('classe chargée par require (hors autoload) : injection impossible ⇒ UNSUPPORTED_PROBE', async () => {
    const root = project({
      'src/Greet.php': GREET,
      'tests/GreetTest.php': testOf("require_once __DIR__ . '/../src/Greet.php';"),
    })
    const ctx = engine(root)
    try {
      const d = await doctor(ctx)
      expect([d.verdict, d.reasons]).toEqual(['UNSUPPORTED_PROBE', ['NO_TARGET_MODULE_WRAPPED']])
    } finally {
      ctx.close()
    }
  }, 120_000)
  it('même projet chargé par l’autoload (vendor/ lié, règles PSR-4 du projet) : OK', async () => {
    const ctx = engine(project({ 'src/Greet.php': GREET, 'tests/GreetTest.php': testOf('') }))
    try {
      const d = await doctor(ctx)
      expect([d.verdict, d.verified.observation, d.verified.argumentMutation]).toEqual([
        'OK',
        'VERIFIED',
        'VERIFIED',
      ])
    } finally {
      ctx.close()
    }
  }, 120_000)
})

describe('PHPUnit (14) : reprise après arrêt brutal du processus Varia', () => {
  it('un fuzz tué (SIGKILL) puis repris ne rejoue aucune mutation déjà persistée', async () => {
    const D = tmp('varia-php-resume-')
    const cfg = join(tmp('varia-cfg-'), 'varia.yml')
    writeFileSync(
      cfg,
      [
        'version: 1',
        'project: { name: phpunit-project }',
        "targets: { mode: auto, include: ['src/Users.php'] }",
        'mutations: { mode: normal, seed: 42 }',
        'execution: { timeout_ms: 30000 }',
        'oracle: { handled_errors: [{ name: ValidationError }], slow_floor_ms: 3600000 }',
      ].join('\n'),
    )
    const ctx = engine(PHPUNIT, { dataDir: D, configFile: cfg })
    const b = await runBaseline(ctx)
    planRun(ctx, b.runId, { maxMutations: 12 })
    const dbPath = join(ctx.dataDir, 'varia.db')
    ctx.close()
    // Processus Varia distinct (moteur + adapter depuis les sources, par tsx), tué en plein fuzz.
    const script = join(tmp('varia-php-script-'), 'fuzz.mts')
    writeFileSync(
      script,
      [
        // Spécificateurs en URL `file:` : `D:\\…` serait lu comme un schéma d'URL sous Windows.
        `import { PhpunitAdapter } from ${JSON.stringify(pathToFileURL(resolve('packages/adapters/phpunit/src/index.ts')).href)}`,
        `import { EngineContext, runFuzz } from ${JSON.stringify(pathToFileURL(resolve('packages/engine/src/index.ts')).href)}`,
        `const ctx = new EngineContext({ root: ${JSON.stringify(PHPUNIT)}, adapter: new PhpunitAdapter(), dataDir: ${JSON.stringify(D)}, configFile: ${JSON.stringify(cfg)} })`,
        `await runFuzz(ctx, ${JSON.stringify(b.runId)})`,
        '',
      ].join('\n'),
    )
    const child = spawn(
      process.execPath,
      [resolve('node_modules/tsx/dist/cli.mjs'), '--tsconfig', resolve('tsconfig.json'), script],
      { cwd: resolve('.'), stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    const persisted = await new Promise<Set<string>>((done, fail) => {
      child.once('error', fail)
      const started = Date.now()
      const timer = setInterval(() => {
        try {
          const o = openReader(dbPath)
          const ids = new Reader(o.db).resultIds(b.runId)
          o.close()
          if (ids.size >= 3) {
            clearInterval(timer)
            child.kill('SIGKILL')
            done(ids)
          }
        } catch {
          // base en cours d'écriture : nouvel essai
        }
        if (Date.now() - started > 90_000) {
          clearInterval(timer)
          child.kill('SIGKILL')
          fail(new Error(`aucun résultat persisté ; stderr de l'enfant : ${stderr}`))
        }
      }, 50)
    })
    await new Promise((r) => child.once('exit', r))
    const again = engine(PHPUNIT, { dataDir: D, configFile: cfg })
    try {
      const before = again.reader.resultIds(b.runId)
      expect(before.size).toBeGreaterThanOrEqual(persisted.size)
      expect(before.size).toBeLessThan(12)
      const r = await runFuzz(again, b.runId)
      expect([r.alreadyDone, r.executed]).toEqual([before.size, 12 - before.size])
      expect(again.reader.resultIds(b.runId).size).toBe(12)
      expect(again.reader.getRun(b.runId)?.state).toBe('COMPLETED')
    } finally {
      again.close()
    }
  }, 180_000)
})
