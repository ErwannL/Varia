import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adapterFor, frameworkOfCommand, runCli, type Io } from '../src/index.js'

function io() {
  const out: string[] = []
  const err: string[] = []
  const sink: Io = { out: (l) => out.push(l), err: (l) => err.push(l) }
  return { out, err, sink }
}
const project = (files: Record<string, string> = {}) => {
  const d = mkdtempSync(join(tmpdir(), 'varia-cli-'))
  writeFileSync(join(d, 'package.json'), '{"name":"x"}')
  for (const [f, c] of Object.entries(files)) writeFileSync(join(d, f), c)
  return d
}
const run = async (
  argv: string[],
  cwd = project(),
  env: NodeJS.ProcessEnv = { LANG: 'fr_FR.UTF-8' },
) => {
  const o = io()
  const code = await runCli(argv, o.sink, { env, cwd })
  return { code, ...o }
}

describe('bannière (prompt §4.2)', () => {
  it('français par défaut, sur stderr', async () => {
    const r = await run(['config', '--check'])
    expect(r.err[0]).toBe('Varia par Orqea · v0.1.0')
    expect(r.code).toBe(0)
  })
  it('anglais avec --lang en ou LANG=en', async () => {
    expect((await run(['--lang', 'en', 'config', '--check'])).err[0]).toBe(
      'Varia by Orqea · v0.1.0',
    )
    expect((await run(['config', '--check'], project(), { LANG: 'en_US.UTF-8' })).err[0]).toBe(
      'Varia by Orqea · v0.1.0',
    )
  })
  it('absente avec --quiet et --json', async () => {
    expect((await run(['--quiet', 'config', '--check'])).err).toEqual([])
    expect((await run(['--json', 'config', '--check'])).err).toEqual([])
  })
  it('--version', async () => {
    const r = await run(['--version'])
    expect(r.out).toEqual(['0.1.0'])
    expect(r.code).toBe(0)
  })
})

describe('configuration (code 3)', () => {
  it('config --check refuse une configuration invalide', async () => {
    const r = await run(['config', '--check'], project({ 'varia.yml': 'version: 2\n' }))
    expect(r.code).toBe(3)
    expect(r.err.join('\n')).toContain('CONFIG_FAILURE')
    expect(r.err.join('\n')).toContain('configuration invalide')
  })
  it('config --print', async () => {
    const r = await run(
      ['config', '--print'],
      project({ 'varia.yml': 'version: 1\ntest: { env: { SECRET_TOKEN: s3cr3t } }\n' }),
    )
    expect(r.out.join('\n')).not.toContain('s3cr3t')
    expect(r.out.join('\n')).toContain('version: 1')
  })
  it('commande inconnue', async () => {
    expect((await run(['nope'])).code).toBe(3)
  })
})

describe('init', () => {
  it('crée varia.yml une seule fois', async () => {
    const d = project()
    expect((await run(['init'], d)).code).toBe(0)
    expect(readFileSync(join(d, 'varia.yml'), 'utf8')).toContain('version: 1')
    expect((await run(['init'], d)).code).toBe(3)
  })
})

describe('erreurs de Varia (codes de sortie §27)', () => {
  it('report sans run : message traduit, code 2', async () => {
    const d = project()
    const r = await run(['--data-dir', join(d, '.data'), 'report'], d)
    expect(r.code).toBe(2)
    expect(r.err.join('\n')).toContain('PROJECT_FAILURE')
  })
  it('baseline sans Jest : RUNNER_FAILURE, code 4', async () => {
    const d = project()
    const r = await run(['--data-dir', join(d, '.data'), 'baseline'], d)
    expect(r.code).toBe(4)
    expect(r.err.join('\n')).toContain('RUNNER_FAILURE')
  })
  it('doctor sans Jest : RUNNER_NOT_FOUND, code 4', async () => {
    const d = project()
    const r = await run(['--data-dir', join(d, '.data'), '--json', 'doctor'], d)
    expect(r.code).toBe(4)
    expect(JSON.parse(r.out.join('\n'))).toMatchObject({
      verdict: 'RUNNER_NOT_FOUND',
      reasons: ['RUNNER_NOT_FOUND'],
    })
  })
})

describe('configuration : test.command, codes non supportés (A-06)', () => {
  it('test.command désigne le framework quand test.framework est absent', () => {
    expect(frameworkOfCommand(undefined)).toBeUndefined()
    expect(frameworkOfCommand('npx vitest run')).toBe('vitest')
    expect(frameworkOfCommand('jest --ci')).toBe('jest')
    expect(frameworkOfCommand('npx mocha --exit')).toBe('mocha')
    expect(frameworkOfCommand('npm test')).toBeUndefined()
    const d = project({ 'varia.yml': 'version: 1\ntest: { command: npx vitest run }\n' })
    expect(adapterFor(d).id).toBe('vitest')
  })
  it('valeur non supportée : code de sortie 3 et message traduit', async () => {
    const d = project({ 'varia.yml': 'version: 1\nexecution: { parallelism: 4 }\n' })
    const r = await run(['config', '--check'], d)
    expect(r.code).toBe(3)
    expect(r.err.join('\n')).toContain(
      'execution.parallelism : non supporté : exécution séquentielle',
    )
  })
})
