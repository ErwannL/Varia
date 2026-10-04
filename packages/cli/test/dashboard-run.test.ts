// `varia dashboard --allow-run` : lancer baseline/tests depuis le tableau de bord, uniquement en local.
import { scripted } from '../../engine/test/fake.js'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli, type CliEnv, type Io } from '../src/index.js'

const project = () => {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'varia-dashrun-')))
  writeFileSync(join(d, 'varia.yml'), 'version: 1\n')
  return d
}
const closer = { url: 'http://127.0.0.1:4321', close: async () => undefined }

async function dash(argv: string[], d: string, cli: Partial<CliEnv> = {}, global: string[] = []) {
  const out: string[] = []
  const err: string[] = []
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l) }
  const started: Parameters<NonNullable<CliEnv['startDashboard']>>[0][] = []
  const code = await runCli(
    ['--data-dir', join(d, '.data'), '--lang', 'en', ...global, 'dashboard', ...argv],
    io,
    {
      env: { LANG: 'fr_FR.UTF-8' },
      cwd: d,
      adapter: () => scripted([], () => ({ returns: 1 })),
      selfCommand: ['node', '/outils/varia.js'],
      startDashboard: async (o) => {
        started.push(o)
        setTimeout(() => process.emit('SIGINT'), 10)
        return closer
      },
      ...cli,
    },
  )
  return { code, err: err.join('\n'), started }
}

describe('dashboard --allow-run', () => {
  it('sans l’option : lecture seule, aucun lanceur transmis', async () => {
    const r = await dash([], project())
    expect(r.code).toBe(0)
    expect(r.started[0]?.run).toBeUndefined()
  })
  it('avec l’option : Varia relancé dans CE projet avec les mêmes options globales', async () => {
    const d = project()
    const r = await dash(['--allow-run'], d, {}, ['-c', 'varia.yml'])
    expect(r.code).toBe(0)
    expect(r.started[0]?.run).toEqual({
      command: ['node', '/outils/varia.js'],
      globalArgs: [
        '-C',
        d,
        '-c',
        join(d, 'varia.yml'),
        '--data-dir',
        join(d, '.data'),
        '--lang',
        'en',
      ],
      cwd: d,
      env: { LANG: 'fr_FR.UTF-8' },
      info: { name: basename(d), root: d, config: join(d, 'varia.yml') },
    })
  })
  it('sans --data-dir explicite : pas de --data-dir (le projet fixe le même dossier par défaut)', async () => {
    const d = project()
    const out: string[] = []
    const started: unknown[] = []
    await runCli(
      ['dashboard', '--allow-run'],
      { out: (l) => out.push(l), err: () => undefined },
      {
        env: {},
        cwd: d,
        adapter: () => scripted([], () => ({ returns: 1 })),
        selfCommand: ['node', 'v.js'],
        startDashboard: async (o) => {
          started.push(o.run?.globalArgs)
          setTimeout(() => process.emit('SIGINT'), 10)
          return closer
        },
      },
    )
    expect(started[0]).not.toContain('--data-dir')
  })
  it('sans fichier de configuration explicite : pas de -c, config nulle', async () => {
    const d = project()
    const run = (await dash(['--allow-run'], d)).started[0]?.run
    expect(run?.globalArgs).not.toContain('-c')
    expect(run?.info.config).toBeNull()
  })
  it.each([
    [['--allow-run', '--host', '0.0.0.0', '--allow-remote'], 'boucle locale'],
    [['--allow-run', '--allow-remote'], 'boucle locale'],
    [['--allow-run', '--data-path', '/data'], '--data-path'],
  ])('refusé (exit 3, serveur jamais démarré) : %j', async (argv, why) => {
    const r = await dash(argv, project())
    expect(r.code).toBe(3)
    expect(r.err).toContain(why)
    expect(r.started).toEqual([])
  })
  it('refusé si Varia ne sait pas se relancer (selfCommand absent)', async () => {
    const r = await dash(['--allow-run'], project(), { selfCommand: undefined })
    expect(r.code).toBe(3)
    expect(r.err).toContain('relance de Varia impossible')
    expect(r.started).toEqual([])
  })
})
