// Tests unitaires de l'adapter Mocha : filtre exact, rapport JSON, configuration générée, détection et
// lancement (superviseur simulé ; l'exécution réelle est couverte par la conformité et tests/j4).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: string[]; opts: Record<string, unknown> }[],
  result: { stdout: '', timedOut: false } as Record<string, unknown>,
  report: null as string | null,
}))

vi.mock('@varia/core', async (orig) => ({
  ...(await orig<typeof import('@varia/core')>()),
  runSupervised: (cmd: string, args: string[], opts: Record<string, unknown>) => {
    h.calls.push({ cmd, args, opts })
    // Le « runner » écrit son rapport JSON là où la configuration générée l'indique.
    const config = JSON.parse(readFileSync(String(args[2]), 'utf8')) as {
      'reporter-option': string[]
    }
    if (h.report !== null)
      writeFileSync(String(config['reporter-option'][0]).slice('output='.length), h.report)
    return Promise.resolve(h.result)
  },
}))

const {
  MochaAdapter,
  MOCHA_CAPABILITIES,
  REGISTER_PATH,
  ESM_HOOKS_PATH,
  REWRITE_PATH,
  exactGrep,
  mochaRunConfig,
  parseMochaReport,
} = await import('../src/adapter.js')

function dir(files: Record<string, string> = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'varia-mocha-'))
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(d, f, '..'), { recursive: true })
    writeFileSync(join(d, f), c)
  }
  return d
}
/** Copie factice de Mocha : `loadOptions` renvoie les arguments reçus, `findConfig` le fichier .mocharc. */
const FAKE_MOCHA = {
  'node_modules/mocha/package.json': JSON.stringify({ name: 'mocha', version: '11.0.1' }),
  'node_modules/mocha/lib/cli/options.js':
    "exports.loadOptions = (argv) => ({ _: ['t/**/*.js'], config: false, package: false, argv, timeout: 5, grep: 'projet', fgrep: 'x', invert: true, reporterOption: ['a=b'] })",
  'node_modules/mocha/lib/cli/config.js':
    "const fs = require('fs'); const p = require('path'); exports.findConfig = (cwd) => fs.existsSync(p.join(cwd, '.mocharc.json')) ? p.join(cwd, '.mocharc.json') : undefined",
}
const redact = { fields: [], patterns: [], skipPaths: [], hmacKey: 'k' }

beforeEach(() => {
  h.calls.length = 0
  h.result = { stdout: '', timedOut: false }
  h.report = null
})

describe('filtre --grep exact', () => {
  it('métacaractères échappés, ancré, fins de ligne en \\uXXXX', () => {
    const name = 'a.b (c) [d] * + ? ^ $ { } | \\ / x\ny\rz\u2028w\u2029'
    const re = new RegExp(exactGrep(name))
    expect(re.test(name)).toBe(true)
    expect(re.test(`${name} `)).toBe(false)
    expect(re.test('aXb (c) [d] * + ? ^ $ { } | \\ / x\ny\rz\u2028w\u2029')).toBe(false)
    expect(exactGrep('x\ny')).toBe('^x\\u000ay$')
    // Mocha lit la chaîne avec `.*` (sans drapeau s) : aucune fin de ligne brute ne doit subsister.
    expect(/[\n\r\u2028\u2029]/.test(exactGrep(name))).toBe(false)
  })
})

describe('rapport JSON de Mocha', () => {
  it('JSON invalide : null', () => {
    expect(parseMochaReport('{"tests": [', '/p')).toBeNull()
  })
  it('passés, échoués, en attente ; doublons numérotés comme la sonde ; fichier absent', () => {
    const r = parseMochaReport(
      JSON.stringify({
        tests: [
          { fullTitle: 't', file: '/p/a.test.js', duration: 3, err: {} },
          { fullTitle: 't', file: '/p/a.test.js', err: { message: 'x' } },
          { fullTitle: 'u' },
        ],
        pending: [{ fullTitle: 'v', file: '/p/a.test.js' }],
      }),
      '/p',
    )
    expect(r?.map((t) => [t.file, t.name, t.status, t.durationMs])).toEqual([
      ['a.test.js', 't', 'passed', 3],
      ['a.test.js', 't', 'failed', null],
      ['', 'u', 'passed', null],
      ['a.test.js', 'v', 'skipped', null],
    ])
    expect(new Set(r?.map((t) => t.testId)).size).toBe(4)
  })
})

describe('configuration générée', () => {
  const o = { files: [], grep: null, setupFile: '/t/s.cjs', reportFile: '/t/r.json' }
  it('options du projet conservées ; rapporteur, sonde, série imposés ; filtres du projet retirés', () => {
    const c = mochaRunConfig(
      {
        _: ['a.js'],
        spec: 'b.js',
        config: '/p/.mocharc.json',
        package: '/p/package.json',
        require: 'ts-node/register',
        timeout: 5,
        parallel: true,
        grep: 'x',
        fgrep: 'y',
        invert: true,
        'reporter-options': ['k=v'],
        reporterOptions: ['k=v'],
        reporterOption: ['k=v'],
      },
      o,
    )
    expect(c).toEqual({
      spec: ['a.js', 'b.js'],
      require: ['ts-node/register', '/t/s.cjs'],
      timeout: 5,
      reporter: 'json',
      'reporter-option': ['output=/t/r.json'],
      parallel: false,
      watch: false,
      color: false,
    })
  })
  it('fichier et nom sélectionnés ; projet sans spec ni require', () => {
    expect(mochaRunConfig({}, { ...o, files: ['/p/t.js'], grep: '^t$' })).toMatchObject({
      spec: ['/p/t.js'],
      require: ['/t/s.cjs'],
      grep: '^t$',
    })
    // Ni fichier ni spec : clé absente (défaut de Mocha, ./test), même si le projet a `spec: []`.
    const none = mochaRunConfig({ require: ['a', 'b'], spec: [] }, o)
    expect(none).toMatchObject({ require: ['a', 'b', '/t/s.cjs'] })
    expect(none).not.toHaveProperty('spec')
  })
})

describe('MochaAdapter', () => {
  it('capacités déclarées (copie) ; module d’injection livré', () => {
    const a = new MochaAdapter()
    expect(a.id).toBe('mocha')
    expect(a.capabilities()).toEqual(MOCHA_CAPABILITIES)
    expect(a.capabilities()).not.toBe(MOCHA_CAPABILITIES)
    expect(readFileSync(REGISTER_PATH, 'utf8')).toContain('mochaHooks')
  })
  it('detect : version de Mocha du projet ; absent ; ESM natif pris en charge', async () => {
    const a = new MochaAdapter()
    expect(await a.detect(dir({ 'package.json': '{}', ...FAKE_MOCHA }))).toEqual({
      detected: true,
      framework: 'mocha',
      version: '11.0.1',
      nativeEsm: false,
      reasons: [],
    })
    expect(await a.detect(dir())).toEqual({
      detected: false,
      framework: 'mocha',
      version: null,
      nativeEsm: false,
      reasons: ['RUNNER_NOT_FOUND'],
    })
    expect(
      await a.detect(dir({ 'package.json': '{"type":"module"}', ...FAKE_MOCHA })),
    ).toMatchObject({ detected: true, nativeEsm: false, reasons: [] })
  })
  it('run avant prepare : erreur', async () => {
    await expect(
      new MochaAdapter().run({ mode: 'observe', runDir: dir(), timeoutMs: 1 }),
    ).rejects.toThrow('prepare()')
  })
  it('prepare : configuration du projet lue (.mocharc, package.json), setup généré hors du projet', async () => {
    const root = dir({ 'package.json': '{}', '.mocharc.json': '{}', ...FAKE_MOCHA })
    const tmp = dir()
    const a = new MochaAdapter()
    await a.prepare({
      root,
      tmpDir: tmp,
      runId: 'r_1',
      include: ['src/**'],
      exclude: ['src/gen/**'],
      redact,
    })
    const setup = readFileSync(join(tmp, 'varia-mocha-setup.cjs'), 'utf8')
    expect(setup).toContain(JSON.stringify(REGISTER_PATH))
    expect(setup).toContain('register.start(')
    // Projet CommonJS : aucun crochet ESM (coût du fil des chargeurs évité).
    expect(setup).not.toContain('esm-hooks')
    // Projet ESM : crochets enregistrés avec la réécriture de l'adapter Vitest (fichier livré).
    const esmTmp = dir()
    await new MochaAdapter().prepare({
      root: dir({ 'package.json': '{"type":"module"}', ...FAKE_MOCHA }),
      tmpDir: esmTmp,
      runId: 'r_1',
      include: [],
      exclude: [],
      redact,
    })
    const esmSetup = readFileSync(join(esmTmp, 'varia-mocha-setup.cjs'), 'utf8')
    expect(esmSetup).toContain(
      `require('module').register(${JSON.stringify(pathToFileURL(ESM_HOOKS_PATH).href)}`,
    )
    expect(esmSetup).toContain(JSON.stringify(REWRITE_PATH))
    expect(readFileSync(REWRITE_PATH, 'utf8')).toContain('export function rewriteExports')
    expect(setup).toContain(JSON.stringify(root))
    expect(JSON.parse(readFileSync(join(tmp, 'targets.json'), 'utf8'))).toEqual({
      runId: 'r_1',
      projectRoot: root,
    })
    expect(JSON.parse(readFileSync(join(tmp, 'redact.json'), 'utf8'))).toEqual(redact)
    const runDir = dir()
    h.report = JSON.stringify({
      tests: [{ fullTitle: 't', file: join(root, 'a.test.js'), err: {} }],
      pending: [],
    })
    writeFileSync(
      join(runDir, 'probe-12.jsonl'),
      '{"protocolVersion":1,"runId":"r_1","type":"HELLO","testId":null,"timestamp":"2026-10-03T11:42:03.925Z","protocolMinor":1,"mode":"fuzz","pid":12,"mutationId":"m1"}\nnot json\n{}\n',
    )
    writeFileSync(join(runDir, 'other.jsonl'), 'ignoré')
    const r = await a.run({
      mode: 'fuzz',
      runDir,
      timeoutMs: 1000,
      testFile: 'a.test.js',
      testName: 'a (b)',
      planPath: '/plan.json',
      mutationId: 'm1',
      maxOutputBytes: 10,
    })
    const call = h.calls[0]
    expect(call?.cmd).toBe(process.execPath)
    expect(call?.args).toEqual([
      join(root, 'node_modules', 'mocha', 'lib', 'cli', 'cli.js'),
      '--config',
      join(runDir, 'mocharc.json'),
      '--no-package',
    ])
    const config = JSON.parse(readFileSync(join(runDir, 'mocharc.json'), 'utf8')) as Record<
      string,
      unknown
    >
    expect(config).toMatchObject({
      spec: [join(root, 'a.test.js')],
      grep: '^a \\(b\\)$',
      require: [join(tmp, 'varia-mocha-setup.cjs')],
      argv: ['--config', join(root, '.mocharc.json'), '--package', join(root, 'package.json')],
    })
    expect(config).not.toHaveProperty('fgrep')
    expect(call?.opts).toMatchObject({ cwd: root, timeoutMs: 1000, maxOutputBytes: 10 })
    const env = call?.opts['env'] as Record<string, string>
    expect([env['VARIA_MODE'], env['VARIA_PLAN'], env['VARIA_MUTATION_ID']]).toEqual([
      'fuzz',
      '/plan.json',
      'm1',
    ])
    expect(r.tests?.map((t) => [t.file, t.status])).toEqual([['a.test.js', 'passed']])
    expect(r.events.map((e) => e.type)).toEqual(['HELLO'])
    expect([r.truncatedLines, r.invalidLines]).toEqual([1, 1])
  })
  it('sans .mocharc ni package.json, test.cwd, env, mémoire ; processus tué ou sans rapport : tests null', async () => {
    const root = dir({ 'package.json': '{}', ...FAKE_MOCHA, 'sub/x': '' })
    const tmp = dir()
    const a = new MochaAdapter()
    const sub = join(root, 'sub')
    await a.prepare({
      root,
      cwd: sub,
      env: { A: '1' },
      memoryMb: 256,
      tmpDir: tmp,
      runId: 'r_2',
      include: [],
      exclude: [],
      redact,
    })
    const prev = process.env['VARIA_STALE']
    process.env['VARIA_STALE'] = 'x'
    const runDir = dir()
    const r = await a.run({ mode: 'observe', runDir, timeoutMs: 5, env: { B: '2' } })
    if (prev === undefined) delete process.env['VARIA_STALE']
    else process.env['VARIA_STALE'] = prev
    const call = h.calls[0]
    const config = JSON.parse(readFileSync(join(runDir, 'mocharc.json'), 'utf8')) as Record<
      string,
      unknown
    >
    expect(config).toMatchObject({ argv: ['--no-config', '--no-package'], spec: ['t/**/*.js'] })
    expect(config).not.toHaveProperty('grep')
    const env = call?.opts['env'] as Record<string, string | undefined>
    expect(call?.opts['cwd']).toBe(sub)
    expect([env['A'], env['B'], env['VARIA_STALE'], env['VARIA_PLAN']]).toEqual([
      '1',
      '2',
      undefined,
      undefined,
    ])
    expect(env['NODE_OPTIONS']).toContain('--max-old-space-size=256')
    expect(r.tests).toBeNull()
    h.report = '{"tests":[],"pending":[]}'
    h.result = { stdout: '', timedOut: true }
    expect((await a.run({ mode: 'observe', runDir: dir(), timeoutMs: 5 })).tests).toBeNull()
  })
})
