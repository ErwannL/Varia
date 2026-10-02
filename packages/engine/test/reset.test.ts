// A-06 : `reset.database: command`, `reset.filesystem: tmpdir`, `test.env`, `test.cwd` réellement appliqués.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EngineContext,
  filesystemEnv,
  planRun,
  runBaseline,
  runFuzz,
  shellFor,
  VariaError,
} from '../src/index.js'
import { context, FakeAdapter, project, scripted } from './fake.js'

const TESTS = [{ name: 'crée', calls: [{ args: [{ name: 'Ada' }] }] }]
const yml = (reset: string, extra = '') =>
  `version: 1\nmutations: { seed: 1, per_input: 2, strategies: ['null'] }\nexecution: { timeout_ms: 5000, reset: ${reset} }\n${extra}`

async function fuzzAll(ctx: EngineContext) {
  const b = await runBaseline(ctx)
  planRun(ctx, b.runId)
  await runFuzz(ctx, b.runId)
  return ctx.reader.results(b.runId)
}

describe('reset de base (execution.reset.database: command)', () => {
  it('exécutée avant CHAQUE mutation, dans le projet, avec test.env', async () => {
    const root = project()
    const log = join(root, 'reset.log')
    const script = join(root, 'reset.cjs')
    writeFileSync(
      script,
      "require('fs').appendFileSync(process.argv[2], process.env.GREETING + '\\n')\n",
    )
    const adapter = scripted(TESTS)
    const ctx = context(
      adapter,
      undefined,
      project(
        yml(
          // Commande neutre (sh et cmd.exe) : un script Node ajoute la variable au journal.
          `{ database: command, database_command: 'node ${script} ${log}' }`,
          'test: { env: { GREETING: bonjour } }',
        ),
      ),
    )
    const results = await fuzzAll(ctx)
    expect(results.length).toBe(2)
    expect(results.every((r) => r.status === 'PASSED')).toBe(true)
    expect(readFileSync(log, 'utf8')).toBe('bonjour\nbonjour\n')
    ctx.close()
  })
  it('échec du reset ⇒ INFRA_ERROR / RESET_FAILED, la mutation n’est pas exécutée', async () => {
    const adapter = scripted(TESTS)
    const ctx = context(adapter, yml('{ database: command, database_command: "exit 3" }'))
    const results = await fuzzAll(ctx)
    expect(results.map((r) => [r.status, r.reason, r.exitCode])).toEqual([
      ['INFRA_ERROR', 'RESET_FAILED', 3],
      ['INFRA_ERROR', 'RESET_FAILED', 3],
    ])
    expect(adapter.runs.filter((r) => r.mode === 'fuzz')).toHaveLength(0)
    ctx.close()
  })
  it('shell de la plateforme (les deux branches)', () => {
    expect(shellFor('x', 'linux')).toEqual(['/bin/sh', ['-c', 'x']])
    expect(shellFor('x', 'win32')).toEqual(['cmd.exe', ['/d', '/s', '/c', 'x']])
  })
})

describe('système de fichiers jetable (execution.reset.filesystem: tmpdir)', () => {
  it('un répertoire propre à chaque mutation, exposé par VARIA_TMPDIR/TMPDIR, supprimé ensuite', async () => {
    const seen: string[] = []
    const adapter = new FakeAdapter((o) => {
      if (o.mode === 'fuzz') {
        const dir = o.env?.['VARIA_TMPDIR'] ?? ''
        expect(existsSync(dir)).toBe(true)
        expect([o.env?.['TMPDIR'], o.env?.['TMP'], o.env?.['TEMP']]).toEqual([dir, dir, dir])
        seen.push(dir)
      }
      return scripted(TESTS).run(o)
    })
    const ctx = context(adapter, yml('{ filesystem: tmpdir }'))
    await fuzzAll(ctx)
    expect(seen).toHaveLength(2)
    expect(new Set(seen).size).toBe(2)
    expect(seen.every((d) => !existsSync(d))).toBe(true)
    ctx.close()
  })
  it('sans reset : aucune variable ajoutée', () => {
    const ctx = context(
      new FakeAdapter(() => scripted(TESTS).run({ mode: 'observe', runDir: '', timeoutMs: 1 })),
    )
    expect(filesystemEnv(ctx, '/x')).toEqual({})
    ctx.close()
  })
})

describe('test.env et test.cwd transmis au runner', () => {
  it('dans le contexte de préparation de l’adapter', async () => {
    const root = project(`version: 1\ntest: { cwd: sub, env: { NODE_ENV: test } }\n`)
    mkdirSync(join(root, 'sub'))
    const adapter = scripted(TESTS)
    const ctx = context(adapter, undefined, root)
    await runBaseline(ctx)
    expect(adapter.prepared[0]).toMatchObject({ cwd: join(root, 'sub'), env: { NODE_ENV: 'test' } })
    ctx.close()
  })
  it('test.cwd absent ou hors du projet ⇒ CONFIG_FAILURE', () => {
    for (const cwd of ['absent', '..']) {
      const root = project(`version: 1\ntest: { cwd: '${cwd}' }\n`)
      expect(
        () => new EngineContext({ root, adapter: scripted(TESTS), dataDir: join(root, '.d') }),
      ).toThrow(VariaError)
    }
  })
})
