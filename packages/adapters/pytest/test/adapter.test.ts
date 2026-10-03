// Adapter pytest (R-02) : interpréteur, PYTHONPATH, rapport, détection, exécutions réelles sur un
// projet jetable hors du dépôt (environnement virtuel de l'exemple, lié).
import {
  parsePytestReport,
  PY_RUNTIME_DIR,
  PytestAdapter,
  PYTEST_CAPABILITIES,
  pythonPath,
  resolvePython,
} from '@varia/adapter-pytest'
import type { PrepareContext } from '@varia/core'
import { testIdOf } from '@varia/probe-runtime'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const EXAMPLE = resolve('examples/pytest-project')
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p))

describe('interpréteur et PYTHONPATH', () => {
  it('.venv puis venv, chemins Windows, sinon python du PATH', () => {
    const has = (set: string[]) => (p: string) => set.includes(p)
    expect(resolvePython('/p', 'linux', has(['/p/.venv/bin/python']))).toBe('/p/.venv/bin/python')
    expect(resolvePython('/p', 'linux', has(['/p/venv/bin/python']))).toBe('/p/venv/bin/python')
    expect(resolvePython('/p', 'linux', has([]))).toBe('python3')
    const win = 'C:\\p\\venv\\Scripts\\python.exe'
    expect(resolvePython('C:\\p', 'win32', has([win]))).toBe(win)
    expect(resolvePython('C:\\p', 'win32', has([]))).toBe('python')
    // Exemple réel : l'environnement virtuel est créé selon la machine qui exécute.
    const venvPython =
      process.platform === 'win32' ? ['.venv', 'Scripts', 'python.exe'] : ['.venv', 'bin', 'python']
    expect(resolvePython(EXAMPLE)).toBe(join(EXAMPLE, ...venvPython))
  })
  it('la sonde en tête, le PYTHONPATH hérité conservé', () => {
    expect(pythonPath(undefined)).toBe(PY_RUNTIME_DIR)
    expect(pythonPath('')).toBe(PY_RUNTIME_DIR)
    expect(pythonPath('/a')).toBe(`${PY_RUNTIME_DIR}${delimiter}/a`)
    expect(existsSync(join(PY_RUNTIME_DIR, 'varia_probe', 'plugin.py'))).toBe(true)
  })
})

describe('rapport du plugin', () => {
  it('testId de la norme, rang des homonymes ; JSON invalide ⇒ null', () => {
    const t = { file: 'tests/t.py', name: 'test_a', status: 'passed', durationMs: 1 }
    const r = parsePytestReport(JSON.stringify({ tests: [t, t] }))
    expect(r?.map((x) => x.testId)).toEqual([
      testIdOf('tests/t.py', 'test_a', 0),
      testIdOf('tests/t.py', 'test_a', 1),
    ])
    expect(parsePytestReport('{')).toBeNull()
  })
})

describe('détection', () => {
  it('version de pytest de l’interpréteur du projet ; absent ⇒ RUNNER_NOT_FOUND', async () => {
    const ok = await new PytestAdapter().detect(EXAMPLE)
    expect([ok.detected, ok.framework, ok.version, ok.nativeEsm]).toEqual([
      true,
      'pytest',
      '9.0.0',
      false,
    ])
    const ko = await new PytestAdapter(() => {
      throw new Error('absent')
    }).detect(EXAMPLE)
    expect([ko.detected, ko.version, ko.reasons]).toEqual([false, null, ['RUNNER_NOT_FOUND']])
    expect(new PytestAdapter().capabilities()).toEqual(PYTEST_CAPABILITIES)
  })
})

function project(): string {
  const root = tmp('varia-pytest-adapter-')
  symlinkSync(join(EXAMPLE, '.venv'), join(root, '.venv'), 'junction')
  const files: Record<string, string> = {
    'pyproject.toml': '[tool.pytest.ini_options]\npythonpath = ["."]\n',
    'src/__init__.py': '',
    'src/greet.py':
      'import time\n\ndef greet(u):\n    return "Hello " + u["name"]\n\ndef nap(s):\n    time.sleep(s)\n',
    'tests/test_greet.py': [
      'from src.greet import greet, nap',
      'def test_a():',
      '    assert greet({"name": "Ada"}) == "Hello Ada"',
      'def test_b():',
      '    assert greet({"name": "Bob"}) == "Hello Bob"',
      'def test_slow():',
      '    nap(0)',
      '',
    ].join('\n'),
  }
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    writeFileSync(join(root, f), c)
  }
  return root
}

const ctxOf = (root: string): PrepareContext => ({
  root,
  tmpDir: tmp('varia-pytest-tmp-'),
  runId: 'r_test',
  include: ['src/**'],
  exclude: [],
  redact: { fields: ['password'], patterns: [], skipPaths: [], hmacKey: 'k' },
  env: { PYTHONPATH: '/inexistant' },
})

describe('exécutions réelles', () => {
  it('prepare() obligatoire avant run()', async () => {
    await expect(
      new PytestAdapter().run({ mode: 'observe', runDir: tmp('r-'), timeoutMs: 1000 }),
    ).rejects.toThrow('prepare')
  })
  it('observation complète, puis un seul test sélectionné EXACTEMENT, en mode fuzz', async () => {
    const root = project()
    const a = new PytestAdapter()
    await a.prepare(ctxOf(root))
    const all = await a.run({ mode: 'observe', runDir: tmp('r-'), timeoutMs: 60_000 })
    expect(all.tests?.map((t) => [t.name, t.status])).toEqual([
      ['test_a', 'passed'],
      ['test_b', 'passed'],
      ['test_slow', 'passed'],
    ])
    expect(all.events.filter((e) => e.type === 'OBSERVE_CALL').map((e) => e.export)).toEqual([
      'greet',
      'greet',
      'nap',
    ])
    expect([all.truncatedLines, all.invalidLines]).toEqual([0, 0])
    const plan = join(tmp('p-'), 'plan.json')
    writeFileSync(plan, JSON.stringify({ mutations: [] }))
    const one = await a.run({
      mode: 'fuzz',
      runDir: tmp('r-'),
      timeoutMs: 60_000,
      testFile: 'tests/test_greet.py',
      testName: 'test_a',
      planPath: plan,
      mutationId: 'm_absente',
      maxOutputBytes: 1_000_000,
    })
    expect(one.tests?.map((t) => t.name)).toEqual(['test_a'])
    const hello = one.events.find((e) => e.type === 'HELLO')
    expect([hello?.mode, hello?.mutationId]).toEqual(['fuzz', null])
    // Aucun fichier compilé ni cache écrit dans le projet.
    const names = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.name === '.venv' ? [] : e.isDirectory() ? [e.name, ...names(join(d, e.name))] : [e.name],
      )
    expect(names(root).filter((n) => n === '__pycache__' || n === '.pytest_cache')).toEqual([])
  })
  it('processus tué au délai ⇒ aucun résultat de test', async () => {
    const root = project()
    writeFileSync(
      join(root, 'tests', 'test_greet.py'),
      'from src.greet import nap\ndef test_slow():\n    nap(60)\n',
    )
    const a = new PytestAdapter()
    // Sans `test.env`, avec un environnement d'exécution ; une variable VARIA_ héritée est retirée.
    const { env: _e, ...ctx } = ctxOf(root)
    void _e
    await a.prepare(ctx)
    process.env['VARIA_PERIME'] = '1'
    const r = await a
      .run({ mode: 'observe', runDir: tmp('r-'), timeoutMs: 1500, env: { A: '1' } })
      .finally(() => Reflect.deleteProperty(process.env, 'VARIA_PERIME'))
    expect([r.process.timedOut, r.tests]).toEqual([true, null])
  })
  it('processus mort avant la fin de session (os._exit) ⇒ aucun rapport', async () => {
    const root = project()
    writeFileSync(
      join(root, 'tests', 'test_greet.py'),
      'import os\ndef test_exit():\n    os._exit(3)\n',
    )
    const a = new PytestAdapter()
    await a.prepare(ctxOf(root))
    const r = await a.run({ mode: 'observe', runDir: tmp('r-'), timeoutMs: 60_000 })
    expect([r.process.exitCode, r.tests]).toEqual([3, null])
  })
})
