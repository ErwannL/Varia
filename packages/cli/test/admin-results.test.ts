// B-02 : commandes d'administration et de lecture du CLI, adapter scripté (aucun runner réel).
import type { TestAdapter } from '@varia/core'
import Database from 'better-sqlite3'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scripted, type FakeTest } from '../../engine/test/fake.js'
import { runCli, type CliEnv, type Io } from '../src/index.js'

const TESTS: FakeTest[] = [
  { name: 'a', calls: [{ export: 'f', args: [{ name: 'Ada' }] }] },
  { name: 'b', calls: [{ export: 'g', args: ['x'] }] },
]
const YML = "version: 1\nmutations: { seed: 3, per_input: 2, strategies: ['null', type] }\n"
const crashF = () =>
  scripted(TESTS, (m) =>
    m.export === 'f' ? { throws: { name: 'TypeError', message: 'boom' } } : { returns: m.value },
  )

function project(yml: string | null = YML): string {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'varia-admin-')))
  if (yml !== null) writeFileSync(join(d, 'varia.yml'), yml)
  return d
}

async function run(
  argv: string[],
  cwd: string,
  o: { adapter?: TestAdapter; answers?: string[]; cli?: Partial<CliEnv> } = {},
) {
  const out: string[] = []
  const err: string[] = []
  const answers = o.answers
  const io: Io = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    ...(answers !== undefined ? { ask: async () => answers.shift() ?? '' } : {}),
  }
  const adapter = o.adapter ?? crashF()
  const code = await runCli(['--data-dir', join(cwd, '.data'), ...argv], io, {
    env: { LANG: 'fr_FR.UTF-8' },
    cwd,
    adapter: () => adapter,
    ...o.cli,
  })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

const dataDir = (d: string) =>
  join(d, '.data', 'projects', readdirSync(join(d, '.data', 'projects'))[0] ?? '')

const issuesOf = async (d: string) =>
  (
    JSON.parse((await run(['report'], d)).out) as {
      issues: { id: string; target: string; kind: string }[]
    }
  ).issues

describe('doctor, clean, db', () => {
  it('doctor (texte) : runner introuvable, version inconnue', async () => {
    const absent = Object.assign(Object.create(crashF()) as TestAdapter, {
      detect: async () => ({
        detected: false,
        framework: 'fake',
        version: null,
        nativeEsm: false,
        reasons: [],
      }),
    })
    const r = await run(['doctor'], project(), { adapter: absent })
    expect(r.out).toContain('Runner : fake ? · Node')
    expect(r.out).toContain('Verdict : RUNNER_NOT_FOUND')
  })
  it('clean : supprime tmp/ s’il existe, sinon ne dit rien', async () => {
    const d = project()
    expect((await run(['clean'], d)).out).not.toContain('Supprimé')
    mkdirSync(join(dataDir(d), 'tmp', 'x'), { recursive: true })
    expect((await run(['clean'], d)).out).toContain('Supprimé :')
    expect(existsSync(join(dataDir(d), 'tmp'))).toBe(false)
  })
  it('db check : base corrompue ⇒ problèmes listés, code 4', async () => {
    const d = project()
    await run(['-q', 'fuzz'], d)
    const file = join(dataDir(d), 'varia.db')
    // Table étrangère à Varia, remplie puis corrompue sur disque (dernières pages) : integrity_check
    // le signale, alors que la base reste ouvrable et que Varia ne lit jamais cette table.
    const db = new Database(file)
    db.exec('CREATE TABLE zz (a TEXT); CREATE INDEX zz_a ON zz (a)')
    const ins = db.prepare('INSERT INTO zz VALUES (?)')
    for (let i = 0; i < 2000; i++) ins.run(`v${String(i)}`)
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
    const bytes = readFileSync(file)
    bytes.fill(0x41, bytes.length - 4096 + 200, bytes.length - 4096 + 400)
    writeFileSync(file, bytes)
    const r = await run(['db', 'check'], d)
    expect(r.err).toContain('Problème d')
    expect(r.code).toBe(4)
  })
})

describe('dashboard', () => {
  it('sans serveur injecté : rien ; avec : URL annoncée puis arrêt sur Ctrl+C', async () => {
    const d = project()
    expect((await run(['dashboard'], d)).code).toBe(0)
    let closed = false
    const started: { port: number }[] = []
    const pending = run(['dashboard', '--port', '5000'], d, {
      cli: {
        startDashboard: async (o) => {
          started.push(o)
          setTimeout(() => process.emit('SIGINT'), 10)
          return {
            url: 'http://127.0.0.1:5000',
            close: async () => {
              closed = true
            },
          }
        },
      },
    })
    const r = await pending
    expect(started[0]?.port).toBe(5000)
    expect(r.out).toContain('Dashboard : http://127.0.0.1:5000')
    expect(closed).toBe(true)
  })
})

describe('dashboard : adresse d’écoute et hôtes autorisés', () => {
  const closer = { url: 'http://127.0.0.1:4321', close: async () => undefined }
  const sigint = () => setTimeout(() => process.emit('SIGINT'), 10)

  it('par défaut : boucle locale 127.0.0.1, transmise au serveur', async () => {
    const d = project()
    const started: { host: string }[] = []
    const r = await run(['dashboard'], d, {
      cli: {
        startDashboard: async (o) => {
          started.push(o)
          sigint()
          return closer
        },
      },
    })
    expect(r.code).toBe(0)
    expect(started[0]?.host).toBe('127.0.0.1')
  })
  it('--host hors boucle locale sans --allow-remote ⇒ exit 3, serveur jamais démarré', async () => {
    const d = project()
    let called = false
    const r = await run(['dashboard', '--host', '0.0.0.0'], d, {
      cli: {
        startDashboard: async () => {
          called = true
          return closer
        },
      },
    })
    expect(r.code).toBe(3)
    expect(r.err).toContain('0.0.0.0 : ajoutez --allow-remote')
    expect(called).toBe(false)
  })
  it('--host 0.0.0.0 --allow-remote : l’hôte demandé est transmis', async () => {
    const d = project()
    const started: { host: string; port: number }[] = []
    const r = await run(['dashboard', '--host', '0.0.0.0', '--allow-remote', '--port', '4400'], d, {
      cli: {
        startDashboard: async (o) => {
          started.push(o)
          sigint()
          return closer
        },
      },
    })
    expect(r.code).toBe(0)
    expect(started[0]).toMatchObject({ host: '0.0.0.0', port: 4400 })
  })
  it('VARIA_ALLOWED_HOSTS invalide ⇒ exit 3 avant de démarrer ; valide ⇒ transmis à l’environnement', async () => {
    const d = project()
    let called = 0
    const startDashboard = async () => {
      called += 1
      sigint()
      return closer
    }
    const bad = await run(['dashboard'], d, {
      cli: { env: { LANG: 'fr_FR.UTF-8', VARIA_ALLOWED_HOSTS: 'pas valide' }, startDashboard },
    })
    expect(bad.code).toBe(3)
    expect(bad.err).toContain('« pas valide » n’est pas un hôte')
    expect(called).toBe(0)
    const good = await run(['dashboard'], d, {
      cli: { env: { LANG: 'fr_FR.UTF-8', VARIA_ALLOWED_HOSTS: 'localhost:4322' }, startDashboard },
    })
    expect(good.code).toBe(0)
    expect(called).toBe(1)
  })
})

describe('dashboard --data-path', () => {
  it('lit un dossier de données sans projet à côté ; dossier sans base ⇒ exit 3', async () => {
    const d = project()
    const data = join(d, 'ext')
    mkdirSync(join(data, 'projects', 'p-1'), { recursive: true })
    writeFileSync(join(data, 'projects', 'p-1', 'varia.db'), '')
    const started: { dataDir: string }[] = []
    const closer = { url: 'http://127.0.0.1:4321', close: async () => undefined }
    const ok = await run(['dashboard', '--data-path', data], d, {
      cli: {
        startDashboard: async (o) => {
          started.push(o)
          setTimeout(() => process.emit('SIGINT'), 10)
          return closer
        },
      },
    })
    expect(ok.code).toBe(0)
    expect(started[0]?.dataDir).toBe(join(data, 'projects', 'p-1'))
    const none = await run(['dashboard', '--data-path', join(d, 'vide')], d, {
      cli: { startDashboard: async () => closer },
    })
    expect(none.code).toBe(3)
    expect(none.err).toContain('aucun varia.db')
  })
})

describe('report, accept, compare', () => {
  it('report --markdown : fichiers écrits, rien sur la sortie JSON', async () => {
    const d = project()
    await run(['-q', 'fuzz'], d)
    const r = await run(['report', '--markdown', 'r.md'], d)
    expect(r.code).toBe(0)
    expect(readFileSync(join(d, 'r.md'), 'utf8')).toContain('src/a.js#f')
  })
  it('accept (base) : chemin et stratégie variables ⇒ « * »', async () => {
    const d = project()
    await run(['-q', 'fuzz'], d)
    const issue = (await issuesOf(d)).find((i) => i.target === 'src/a.js#f')
    const r = await run(['accept', issue?.id ?? '', '--reason', 'connu'], d)
    expect(r.out).toMatch(/Acceptation a_[0-9a-f]+ : src\/a\.js#f \S+ \* — connu/)
  })
  it('compare : nouvelles, disparues, modifiées', async () => {
    const d = project()
    const first = await run(['test'], d)
    const a = /Run (r_[0-9a-z_]+)/.exec(first.out)?.[1] ?? ''
    writeFileSync(join(d, 'varia.yml'), YML.replace('per_input: 2', 'per_input: 1'))
    const throwsAll = scripted(TESTS, () => ({
      throws: { name: 'TypeError', message: 'boom' },
    }))
    const second = await run(['test', '--force'], d, { adapter: throwsAll })
    const b = /Run (r_[0-9a-z_]+)/.exec(second.out)?.[1] ?? ''
    const r = await run(['compare', a, b], d)
    expect(r.out).toContain(`Comparaison ${a} → ${b}`)
    expect(r.out).toMatch(/^ {2}\+ nouvelle : /m)
    expect(r.out).toMatch(/^ {2}- disparue : /m)
    expect(r.out).toMatch(/^ {2}~ \S+ : \d+ → \d+ mutations$/m)
  })
})

describe('oracle suggest sans fichier de configuration', () => {
  it('varia.yml créé à la racine après confirmation', async () => {
    const d = project(null)
    await run(['-q', 'fuzz'], d, {
      adapter: scripted(TESTS, () => ({ throws: { name: 'DomainError', message: 'non' } })),
    })
    const r = await run(['oracle', 'suggest'], d, { answers: ['h', 'o'] })
    expect(r.out).toContain(`Configuration écrite : ${join(d, 'varia.yml')}`)
    expect(readFileSync(join(d, 'varia.yml'), 'utf8')).toContain('name: DomainError')
  })
})
