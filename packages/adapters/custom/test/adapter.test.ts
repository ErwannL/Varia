// Adaptateur custom (X-01) : contrat d'environnement, lecture des résultats, découverte, détection.
// Les lanceurs sont de petits scripts Node écrits dans des dossiers temporaires.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import type { PrepareContext } from '@varia/core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  commandExists,
  CustomAdapter,
  parseDiscovery,
  parseResults,
  resolveExecutable,
  testIdOf,
} from '../src/index.js'

// Racine canonique : l'enfant rapporte `process.cwd()` réel (macOS : /private/var), cf. docs/notes/chemins.md.
const tmp = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'varia-custom-')))
const file = (dir: string, name: string, content: string) => {
  const p = join(dir, name)
  writeFileSync(p, content)
  return p
}

/** Lanceur factice : recopie son environnement VARIA_*, écrit une sonde, des résultats, la couverture. */
const LAUNCHER = `
const fs = require('node:fs'), path = require('node:path')
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('VARIA_') || k === 'NODE_OPTIONS' || k === 'PROJECT_VAR'))
fs.writeFileSync(path.join(process.env.VARIA_RUN_DIR, 'env.json'), JSON.stringify({ env, cwd: process.cwd() }))
const hello = { protocolVersion: 1, runId: 'r', type: 'HELLO', testId: null, timestamp: 't', mode: process.env.VARIA_MODE, pid: process.pid, mutationId: null }
fs.writeFileSync(path.join(process.env.VARIA_RUN_DIR, 'probe-' + process.pid + '.jsonl'), JSON.stringify(hello) + '\\n{"tronq')
fs.writeFileSync(path.join(process.env.VARIA_RUN_DIR, 'probe-x.jsonl'), 'ignoré')
fs.writeFileSync(process.env.VARIA_RESULTS, JSON.stringify({ tests: [{ file: 'a.js', name: 'n', status: 'passed', durationMs: 3 }] }))
if (process.env.VARIA_COVERAGE_DIR) {
  fs.mkdirSync(process.env.VARIA_COVERAGE_DIR, { recursive: true })
  const body = process.env.COVERAGE === 'bad' ? '{' : JSON.stringify({ total: {}, 'src/a.js': { lines: { pct: 50 }, statements: { pct: 50 }, functions: { pct: 100 }, branches: { pct: 'Unknown' } } })
  fs.writeFileSync(path.join(process.env.VARIA_COVERAGE_DIR, 'coverage-summary.json'), body)
}
if (process.env.HANG) setInterval(() => {}, 1000)
`

afterEach(() => {
  delete process.env['VARIA_PLAN']
  delete process.env['COVERAGE']
  delete process.env['HANG']
})

function context(root: string, extra: Partial<PrepareContext> = {}): PrepareContext {
  const tmpDir = tmp()
  return {
    root,
    tmpDir,
    runId: 'run-1',
    include: ['src/**'],
    exclude: ['src/skip.js'],
    redact: { fields: ['password'], patterns: [], skipPaths: [], hmacKey: 'k' },
    ...extra,
  }
}

describe('lecture des résultats', () => {
  it('rangs des homonymes, durée inconnue, statuts du contrat', () => {
    const d = tmp()
    const f = file(
      d,
      'r.json',
      JSON.stringify({
        tests: [
          { file: 'a.js', name: 'x', status: 'passed', durationMs: 2 },
          { file: 'a.js', name: 'x', status: 'failed' },
          { file: 'a.js', name: 'y', status: 'skipped', durationMs: 'lent' },
          { file: 'a.js', name: 'z', status: 'other', durationMs: Infinity },
        ],
      }),
    )
    const r = parseResults(f)
    expect(r?.map((t) => [t.testId, t.status, t.durationMs])).toEqual([
      [testIdOf('a.js', 'x', 0), 'passed', 2],
      [testIdOf('a.js', 'x', 1), 'failed', null],
      [testIdOf('a.js', 'y', 0), 'skipped', null],
      [testIdOf('a.js', 'z', 0), 'other', null],
    ])
    // Identité du protocole (§8.1), valeur du jeu de conformité.
    expect(testIdOf('tests/a.test.js', 'suite cas', 0)).toMatch(/^t_[0-9a-f]{16}$/)
  })
  it.each([
    ['absent', null],
    ['illisible', '{'],
    ['pas un objet', '[]'],
    ['sans tests', '{}'],
    ['entrée non objet', '{"tests":[1]}'],
    ['champ manquant', '{"tests":[{"file":"a","status":"passed"}]}'],
    ['statut inconnu', '{"tests":[{"file":"a","name":"n","status":"vert"}]}'],
  ])('%s ⇒ aucun résultat exploitable (null)', (_n, content) => {
    const d = tmp()
    expect(parseResults(content === null ? join(d, 'absent') : file(d, 'r.json', content))).toBe(
      null,
    )
  })
})

describe('lecture de la découverte', () => {
  it('version et tests ; version absente ⇒ null', () => {
    const d = tmp()
    expect(
      parseDiscovery(file(d, 'a.json', '{"version":"2.1","tests":[{"file":"f","name":"n"}]}')),
    ).toEqual({ version: '2.1', tests: [{ file: 'f', name: 'n' }] })
    expect(parseDiscovery(file(d, 'b.json', '{"tests":[]}'))).toEqual({ version: null, tests: [] })
  })
  it.each([['{'], ['{"tests":1}'], ['{"tests":[{"file":1,"name":"n"}]}'], ['{"tests":[2]}']])(
    '%s ⇒ null',
    (content) => {
      expect(parseDiscovery(file(tmp(), 'd.json', content))).toBe(null)
    },
  )
})

describe('commande', () => {
  it('node ⇒ le Node de Varia ; chemin relatif résolu dans cwd ; absolu et nom nu inchangés', () => {
    expect(resolveExecutable('node', '/p')).toBe(process.execPath)
    expect(resolveExecutable('./run.js', '/p')).toBe(resolve('/p', 'run.js'))
    expect(resolveExecutable('bin/run', '/p')).toBe(resolve('/p', 'bin', 'run'))
    expect(resolveExecutable('/abs/run', '/p')).toBe('/abs/run')
    expect(resolveExecutable('runner', '/p')).toBe('runner')
  })
  it('existence : chemin, PATH, PATHEXT', () => {
    const d = tmp()
    file(d, 'run.js', '')
    file(d, 'tool.cmd', '')
    expect(commandExists('node', d, {})).toBe(true)
    expect(commandExists('./run.js', d, {})).toBe(true)
    expect(commandExists('./absent.js', d, {})).toBe(false)
    expect(commandExists(join(d, 'run.js'), '/', {})).toBe(true)
    expect(commandExists('run.js', '/', { PATH: `${delimiter}${d}` })).toBe(true)
    expect(commandExists('tool', '/', { PATH: d, PATHEXT: '.EXE;.cmd;' })).toBe(true)
    expect(commandExists('tool', '/', { PATH: d })).toBe(false)
    expect(commandExists('tool', '/', {})).toBe(false)
  })
})

describe('CustomAdapter', () => {
  it('commande vide refusée ; capacités déclarées, fausses par défaut', () => {
    expect(() => new CustomAdapter({ command: [] })).toThrow('CUSTOM_COMMAND_REQUIRED')
    const a = new CustomAdapter({ command: ['node'], capabilities: { observation: true } })
    expect(a.id).toBe('custom')
    expect(a.capabilities().observation).toBe(true)
    expect(Object.values({ ...a.capabilities(), observation: false }).some(Boolean)).toBe(false)
    expect(new CustomAdapter({ command: ['node'] }).capabilities().observation).toBe(false)
  })
  it('fromConfig lit test.custom ; section absente ⇒ erreur', async () => {
    const d = tmp()
    const cfg = file(
      d,
      'varia.yml',
      [
        'version: 1',
        'test:',
        '  framework: custom',
        '  custom:',
        "    command: ['node', 'run.js']",
        "    discover: ['node', 'run.js', '--list']",
        '    capabilities: { observation: true, cjs: true }',
      ].join('\n'),
    )
    const a = CustomAdapter.fromConfig(d, cfg)
    expect([a.capabilities().cjs, a.capabilities().esm]).toEqual([true, false])
    // Découverte configurée : detect l'exécute (ici, script absent ⇒ non détecté).
    expect((await a.detect(d)).reasons).toEqual(['RUNNER_NOT_FOUND'])
    file(d, 'varia.yml', "version: 1\ntest:\n  framework: custom\n  custom: { command: ['x'] }\n")
    expect(CustomAdapter.fromConfig(d).capabilities().observation).toBe(false)
    expect(() => CustomAdapter.fromConfig(d, file(d, 'b.yml', 'version: 1\n'))).toThrow(
      'CUSTOM_COMMAND_REQUIRED',
    )
  })
  it('detect sans découverte : présence de la commande', async () => {
    const d = tmp()
    file(d, 'run.js', '')
    const ok = await new CustomAdapter({ command: ['./run.js'] }).detect(d)
    expect(ok).toEqual({
      detected: true,
      framework: 'custom',
      version: null,
      nativeEsm: false,
      reasons: [],
    })
    const ko = await new CustomAdapter({ command: ['absent-xyz'], env: { PATH: d } }).detect(d)
    expect([ko.detected, ko.reasons]).toEqual([false, ['RUNNER_NOT_FOUND']])
    expect(await new CustomAdapter({ command: ['node'] }).discover(d)).toBe(null)
  })
  it('detect avec découverte : version et tests listés ; échec ⇒ non détecté', async () => {
    const d = tmp()
    process.env['VARIA_PLAN'] = 'hérité'
    file(
      d,
      'list.js',
      `const fs = require('node:fs')
if (process.env.VARIA_PLAN) process.exit(3)
if (process.argv[2] === 'ko') process.exit(1)
fs.writeFileSync(process.env.VARIA_DISCOVER, JSON.stringify({ version: '9.9', tests: [{ file: 't.js', name: 'a' }] }))`,
    )
    const a = new CustomAdapter({ command: ['node'], discover: ['node', 'list.js'] })
    expect(await a.discover(d)).toEqual({ version: '9.9', tests: [{ file: 't.js', name: 'a' }] })
    expect(await a.detect(d)).toMatchObject({ detected: true, version: '9.9', reasons: [] })
    const ko = new CustomAdapter({
      command: ['node'],
      discover: ['node', 'list.js', 'ko'],
      discoverTimeoutMs: 30_000,
    })
    expect(await ko.detect(d)).toMatchObject({ detected: false, version: null })
  })
  it('run avant prepare : erreur', async () => {
    await expect(
      new CustomAdapter({ command: ['node'] }).run({
        mode: 'observe',
        runDir: tmp(),
        timeoutMs: 1,
      }),
    ).rejects.toThrow('prepare')
  })
  it('run : variables du protocole et du contrat, résultats, journaux, couverture', async () => {
    const root = tmp()
    mkdirSync(join(root, 'work'))
    file(root, 'launch.js', LAUNCHER)
    process.env['VARIA_PLAN'] = 'hérité, jamais transmis'
    const a = new CustomAdapter({ command: ['node', '../launch.js'] })
    const ctx = context(root, {
      cwd: join(root, 'work'),
      env: { PROJECT_VAR: 'p' },
      nodeOptions: '--no-warnings',
      memoryMb: 256,
    })
    await a.prepare(ctx)
    expect(JSON.parse(readFileSync(join(ctx.tmpDir, 'targets.json'), 'utf8'))).toEqual({
      runId: 'run-1',
      projectRoot: root,
    })
    const runDir = tmp()
    const r = await a.run({
      mode: 'fuzz',
      runDir,
      timeoutMs: 60_000,
      testFile: 'tests/a.test.js',
      testName: 'suite cas',
      planPath: '/plan.json',
      mutationId: 'm1',
      coverage: true,
      maxOutputBytes: 1_000_000,
      env: { VARIA_TMPDIR: '/t' },
    })
    const seen = JSON.parse(readFileSync(join(runDir, 'env.json'), 'utf8')) as {
      env: Record<string, string>
      cwd: string
    }
    expect(seen.cwd).toBe(join(root, 'work'))
    // Options héritées de l'environnement de Varia, puis celles du projet, puis la limite de mémoire.
    expect(seen.env['NODE_OPTIONS']).toMatch(/(^| )--no-warnings --max-old-space-size=256$/)
    expect({ ...seen.env, NODE_OPTIONS: undefined }).toEqual({
      NODE_OPTIONS: undefined,
      PROJECT_VAR: 'p',
      VARIA_TMPDIR: '/t',
      VARIA_MODE: 'fuzz',
      VARIA_RUN_DIR: runDir,
      VARIA_TARGETS: join(ctx.tmpDir, 'targets.json'),
      VARIA_REDACT: join(ctx.tmpDir, 'redact.json'),
      VARIA_RESULTS: join(runDir, 'results.json'),
      VARIA_INCLUDE: JSON.stringify(['^src/.*$']),
      VARIA_EXCLUDE: JSON.stringify(['^src/skip\\.js$']),
      VARIA_PLAN: '/plan.json',
      VARIA_MUTATION_ID: 'm1',
      VARIA_TEST_FILE: 'tests/a.test.js',
      VARIA_TEST_NAME: 'suite cas',
      VARIA_COVERAGE_DIR: join(runDir, 'coverage'),
    })
    expect(r.tests?.map((t) => t.name)).toEqual(['n'])
    expect(r.events.map((e) => e.type)).toEqual(['HELLO'])
    expect([r.truncatedLines, r.invalidLines]).toEqual([1, 0])
    expect(r.coverage).toEqual([
      { file: 'src/a.js', lines: 50, statements: 50, functions: 100, branches: null },
    ])
  })
  it('run minimal (cwd = racine, sans sélection) ; couverture illisible ou non demandée ⇒ absente', async () => {
    const root = tmp()
    file(root, 'launch.js', LAUNCHER)
    const a = new CustomAdapter({ command: ['node', 'launch.js'] })
    await a.prepare(context(root))
    process.env['COVERAGE'] = 'bad'
    const runDir = tmp()
    const bad = await a.run({ mode: 'observe', runDir, timeoutMs: 60_000, coverage: true })
    expect('coverage' in bad).toBe(false)
    const seen = JSON.parse(readFileSync(join(runDir, 'env.json'), 'utf8')) as {
      env: Record<string, string>
      cwd: string
    }
    expect(seen.cwd).toBe(root)
    expect(
      Object.keys(seen.env)
        .filter((k) => k.startsWith('VARIA_'))
        .sort(),
    ).toEqual([
      'VARIA_COVERAGE_DIR',
      'VARIA_EXCLUDE',
      'VARIA_INCLUDE',
      'VARIA_MODE',
      'VARIA_REDACT',
      'VARIA_RESULTS',
      'VARIA_RUN_DIR',
      'VARIA_TARGETS',
    ])
    const plain = await a.run({ mode: 'observe', runDir: tmp(), timeoutMs: 60_000 })
    expect([plain.tests?.length, 'coverage' in plain]).toEqual([1, false])
  })
  it('délai dépassé ⇒ processus tué, aucun résultat (null)', async () => {
    const root = tmp()
    file(root, 'launch.js', LAUNCHER)
    const a = new CustomAdapter({ command: ['node', 'launch.js'] })
    await a.prepare(context(root))
    process.env['HANG'] = '1'
    const r = await a.run({ mode: 'observe', runDir: tmp(), timeoutMs: 1500 })
    expect([r.process.timedOut, r.tests]).toEqual([true, null])
  })
})
