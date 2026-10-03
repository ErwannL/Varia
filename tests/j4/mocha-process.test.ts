// R-01 : scénarios d'acceptation du §5 (J4) sur examples/mocha-project, via le VRAI CLI.
// (6) boucle infinie ⇒ TIMEOUT, arbre tué, la mutation suivante s'exécute ; (7) sortie de processus ⇒
// CRASH ; (11) aucune valeur sensible brute sur disque (--keep-tmp) ; (13) doctor : capacités vérifiées,
// UNSUPPORTED_PROBE (code 5) quand l'injection est impossible ; (14) reprise après arrêt brutal.
import { systemProcesses } from '@varia/adapter-conformance'
import type { PlannedMutation } from '@varia/core'
import { openReader, Reader } from '@varia/database'
import { spawn } from 'node:child_process'
import {
  existsSync,
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
import { describe, expect, it } from 'vitest'
import { json, newDataDir, projectDir, varia, withReader } from '../j1/helpers.js'

const MOCHA = resolve('examples/mocha-project')

describe('Mocha (6) (7) : boucle infinie et sortie de processus', () => {
  it('TIMEOUT, puis CRASH / PROCESS_EXIT, puis une mutation ordinaire : toutes exécutées, aucun survivant', async () => {
    const D = newDataDir()
    const p = await varia(['--data-dir', D, '-q', 'plan', '--out', join(D, 'all.json')], MOCHA)
    expect(p.code, p.err).toBe(0)
    const all = JSON.parse(readFileSync(join(D, 'all.json'), 'utf8')) as {
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
    writeFileSync(join(D, 'seq.json'), JSON.stringify({ ...all, mutations: ordered }))
    const r = await varia(['--data-dir', D, '--json', 'fuzz', '--plan', join(D, 'seq.json')], MOCHA)
    expect([0, 1]).toContain(r.code)
    const report = json<{
      run: { id: string }
      mutations: { id: string; status: string | null; subtype: string | null }[]
    }>(r)
    const status = (id: string) => report.mutations.find((m) => m.id === id)
    expect(ordered.map((m) => [status(m.id)?.status, status(m.id)?.subtype])).toEqual([
      ['TIMEOUT', null],
      ['CRASH', 'PROCESS_EXIT'],
      ['HANDLED', null],
    ])
    // Aucun processus (superviseur, Mocha) portant l'identifiant du run ne survit (ps, ou PowerShell
    // sous Windows : l'assertion est faite sur chaque plateforme).
    const procs = systemProcesses()
    expect(procs).not.toBeNull()
    expect(procs?.filter((l) => l.includes(report.run.id))).toEqual([])
  })
})

describe('Mocha (11) : aucune valeur sensible brute sur disque', () => {
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
  it('journaux conservés (--keep-tmp), configuration générée, base, rapport : aucun secret brut', async () => {
    const D = newDataDir()
    const out = mkdtempSync(join(tmpdir(), 'varia-mocha-rapports-'))
    const r = await varia(
      [
        '--data-dir',
        D,
        '--keep-tmp',
        'ci',
        '--quick',
        '--max-mutations',
        '12',
        '--function',
        'createUser',
        '--json-out',
        join(out, 'r.json'),
      ],
      MOCHA,
    )
    expect([0, 1], r.err).toContain(r.code)
    const all = [...files(D), ...files(out)]
    const jsonl = all.filter((f) => f.endsWith('.jsonl'))
    // Non vide : journaux de sonde conservés, mot de passe présent mais masqué ; rapports Mocha présents.
    expect(jsonl.length).toBeGreaterThan(0)
    const logs = jsonl.map((f) => readFileSync(f, 'utf8')).join('\n')
    expect(logs).toContain('"export":"createUser"')
    expect(logs).toMatch(/"password":\{"\$redacted"/)
    expect(all.some((f) => f.endsWith('mocha-report.json'))).toBe(true)
    const leaks = [
      ...all.flatMap((f) => {
        const c = readFileSync(f).toString('latin1')
        return SECRETS.filter((s) => c.includes(s)).map((s) => `${s} dans ${f}`)
      }),
      ...SECRETS.filter((s) => r.out.includes(s) || r.err.includes(s)).map((s) => `${s} en sortie`),
    ]
    expect(leaks).toEqual([])
  })
})

/** Projet Mocha jetable hors du dépôt (Mocha de l'exemple, lié) : fichiers donnés. */
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'varia-mocha-proj-'))
  symlinkSync(join(MOCHA, 'node_modules'), join(root, 'node_modules'), 'junction')
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    writeFileSync(join(root, f), c)
  }
  return root
}
const CONFIG =
  "version: 1\ntest: { framework: mocha }\ntargets: { mode: auto, include: ['src/**'] }\n"

describe('Mocha (13) : doctor', () => {
  it('exemple CommonJS : capacités déclarées vérifiées par test de fumée, le reste dit avec sa raison', async () => {
    const r = await varia(['--data-dir', newDataDir(), '--json', 'doctor'], MOCHA)
    expect(r.code, r.err).toBe(0)
    const d = json<{
      adapter: string
      verdict: string
      verified: Record<string, string>
      checks: Record<string, { status: string; reason: string | null }>
    }>(r)
    expect([d.adapter, d.verdict]).toEqual(['mocha', 'OK'])
    expect(d.verified).toEqual({
      observation: 'VERIFIED',
      argumentMutation: 'VERIFIED',
      perTestSelection: 'VERIFIED',
      asyncTargets: 'VERIFIED',
      esm: 'NOT_VERIFIED',
      cjs: 'VERIFIED',
      mocks: 'UNSUPPORTED',
      testParameters: 'NOT_VERIFIED',
      coverage: 'UNSUPPORTED',
      isolatedProcess: 'VERIFIED',
      parallelSafe: 'UNSUPPORTED',
    })
    expect(d.checks.esm).toEqual({ status: 'NOT_VERIFIED', reason: 'OTHER_MODULE_SYSTEM' })
    expect(d.checks.testParameters).toEqual({ status: 'NOT_VERIFIED', reason: 'NO_SMOKE_TEST' })
    expect(d.checks.coverage).toEqual({ status: 'UNSUPPORTED', reason: 'NOT_DECLARED' })
  })
  it('projet Mocha en ESM natif : ESM vérifié (crochets module.register)', async () => {
    const root = project({
      'package.json': '{"type":"module","devDependencies":{"mocha":"11.7.6"}}',
      'varia.yml': CONFIG,
      'src/greet.js': "export function greet(u) {\n  return 'Hello ' + u.name\n}\n",
      'test/greet.spec.js': [
        "import assert from 'node:assert'",
        "import { greet } from '../src/greet.js'",
        "it('greet', () => assert.strictEqual(greet({ name: 'Ada' }), 'Hello Ada'))",
        '',
      ].join('\n'),
    })
    const r = await varia(['--data-dir', newDataDir(), '--json', 'doctor'], root)
    expect(r.code, r.err).toBe(0)
    const d = json<{ verdict: string; verified: Record<string, string> }>(r)
    expect(d.verdict).toBe('OK')
    expect(d.verified).toMatchObject({
      observation: 'VERIFIED',
      argumentMutation: 'VERIFIED',
      perTestSelection: 'VERIFIED',
      esm: 'VERIFIED',
      cjs: 'NOT_VERIFIED',
    })
  })
  it('cibles chargées hors du chargeur de modules (vm) : injection impossible ⇒ UNSUPPORTED_PROBE (code 5)', async () => {
    const root = project({
      'package.json': '{"devDependencies":{"mocha":"11.7.6"}}',
      'varia.yml': CONFIG,
      'src/greet.js': "module.exports = { greet: (u) => 'Hello ' + u.name }\n",
      // Le module est évalué par vm, sans require : aucun crochet de chargement ne le voit.
      'test/greet.spec.js': [
        "const assert = require('node:assert')",
        "const { readFileSync } = require('node:fs')",
        "const vm = require('node:vm')",
        'const m = { exports: {} }',
        "vm.runInThisContext('(function (module) {' + readFileSync(require.resolve('../src/greet.js'), 'utf8') + '})')(m)",
        "it('greet', () => assert.strictEqual(m.exports.greet({ name: 'Ada' }), 'Hello Ada'))",
        '',
      ].join('\n'),
    })
    const r = await varia(['--data-dir', newDataDir(), '--json', 'doctor'], root)
    expect(r.code, r.err).toBe(5)
    expect(json<{ adapter: string; verdict: string; reasons: string[] }>(r)).toMatchObject({
      adapter: 'mocha',
      verdict: 'UNSUPPORTED_PROBE',
      reasons: ['NO_TARGET_MODULE_WRAPPED'],
    })
  })
})

describe('Mocha (14) : reprise après arrêt brutal du processus Varia', () => {
  it('`varia fuzz --resume` ne rejoue aucune mutation déjà persistée', async () => {
    const bin = resolve('bin/varia')
    expect(
      existsSync(resolve('packages/cli/dist/main.js')),
      'lancer `npm run build` avant les tests',
    ).toBe(true)
    const D = newDataDir()
    // Cibles qui ne bouclent ni ne quittent : la durée ne dépend que du nombre de mutations.
    const cfg = join(mkdtempSync(join(tmpdir(), 'varia-cfg-')), 'varia.yml')
    writeFileSync(
      cfg,
      [
        'version: 1',
        'project: { name: mocha-project }',
        'test: { framework: mocha }',
        "targets: { mode: auto, include: ['src/users.js'] }",
        'mutations: { mode: normal, seed: 42 }',
        'execution: { timeout_ms: 30000 }',
        'oracle: { handled_errors: [{ name: ValidationError }], slow_floor_ms: 3600000 }',
      ].join('\n'),
    )
    const cli = (args: string[]) => varia(['--data-dir', D, '--config', cfg, ...args], MOCHA)
    expect((await cli(['-q', 'baseline'])).code).toBe(0)
    expect((await cli(['-q', 'plan', '--max-mutations', '12'])).code).toBe(0)
    const dbPath = join(projectDir(D), 'varia.db')
    const runId = withReader(D, (r) => r.listRuns(1)[0]?.id ?? '')
    const child = spawn(process.execPath, [bin, '--data-dir', D, '--config', cfg, '-q', 'fuzz'], {
      cwd: MOCHA,
      stdio: 'ignore',
    })
    const persisted = await new Promise<Set<string>>((done, fail) => {
      const started = Date.now()
      const timer = setInterval(() => {
        const o = openReader(dbPath)
        const ids = new Reader(o.db).resultIds(runId)
        o.close()
        if (ids.size >= 3) {
          clearInterval(timer)
          child.kill('SIGKILL')
          done(ids)
        } else if (Date.now() - started > 90_000) {
          clearInterval(timer)
          child.kill('SIGKILL')
          fail(new Error('aucun résultat persisté'))
        }
      }, 50)
    })
    await new Promise((r) => child.once('exit', r))
    const before = withReader(D, (r) => r.resultIds(runId))
    expect(before.size).toBeGreaterThanOrEqual(persisted.size)
    expect(before.size).toBeLessThan(12)
    const resumed = await cli(['-q', 'fuzz', '--resume', runId])
    expect([0, 1]).toContain(resumed.code)
    withReader(D, (r) => {
      const second = r
        .events(runId, 'MUTATION_STARTED')
        .map((e) => e.data as { mutationId: string; invocation: string })
        .filter((e) => e.invocation === '2')
        .map((e) => e.mutationId)
      for (const id of before) expect(second, id).not.toContain(id)
      expect(second.length).toBe(12 - before.size)
      expect(r.resultIds(runId).size).toBe(12)
      expect(r.getRun(runId)?.state).toBe('COMPLETED')
    })
  })
})
