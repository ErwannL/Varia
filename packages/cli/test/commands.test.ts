// B-02 : une vérification par commande et par option ajoutées (sortie et code de sortie).
import { EngineContext } from '@varia/engine'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FakeAdapter } from '../../engine/test/fake.js'
import { runCli, type Io } from '../src/index.js'

function project(files: Record<string, string> = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'varia-cmd-'))
  writeFileSync(join(d, 'package.json'), '{"name":"x"}')
  for (const [f, c] of Object.entries(files)) writeFileSync(join(d, f), c)
  return d
}

async function run(argv: string[], cwd: string, answers?: string[]) {
  const out: string[] = []
  const err: string[] = []
  const asked: string[] = []
  const io: Io = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    ...(answers !== undefined
      ? {
          ask: async (q: string) => {
            asked.push(q)
            return answers.shift() ?? ''
          },
        }
      : {}),
  }
  const code = await runCli(argv, io, { env: { LANG: 'fr_FR.UTF-8' }, cwd })
  return { code, out: out.join('\n'), err: err.join('\n'), asked }
}

/** Contexte du moteur sur le même projet et le même stockage que le CLI, pour préparer la base. */
function seedRuns(root: string, data: string, runs: number, unexpected: string[] = []) {
  const ctx = new EngineContext({
    root,
    adapter: new FakeAdapter(() => {
      throw new Error('non utilisé')
    }),
    dataDir: data,
  })
  ctx.writer.upsertProject({ id: ctx.projectId, name: 'x', root, framework: 'jest' })
  const ids: string[] = []
  for (let i = 0; i < runs; i++) {
    const id = `r_${String(i).padStart(12, '0')}`
    ids.push(id)
    ctx.writer.createRun({
      id,
      projectId: ctx.projectId,
      state: 'COMPLETED',
      mode: 'normal',
      seed: 1,
      gitCommit: null,
      gitBranch: null,
      variaVersion: '0.1.0',
      configHash: 'c',
      envHash: 'e',
      planPath: null,
      partial: false,
      info: {},
    })
  }
  unexpected.forEach((name, n) =>
    ctx.writer.saveResult(ids.at(-1) ?? '', {
      mutationId: `m_${String(n)}`,
      status: 'UNEXPECTED_FAILURE',
      subtype: null,
      reason: null,
      outcome: 'throw',
      testStatus: 'failed',
      durationMs: 1,
      exitCode: 1,
      signal: null,
      timedOut: false,
      error: { name, message: `msg ${name}`, stack: '', constructorChain: [name] },
      echoPath: null,
    }),
  )
  ctx.close()
  return ids
}

describe('version, list', () => {
  it('varia version (texte et --json)', async () => {
    const d = project()
    expect((await run(['-q', 'version'], d)).out).toBe('0.1.0')
    const j = JSON.parse((await run(['--json', 'version'], d)).out) as {
      varia: string
      node: string
    }
    expect([j.varia, j.node]).toEqual(['0.1.0', process.version])
  })
  it('list adapters | strategies ; autre ⇒ exit 3', async () => {
    const d = project()
    expect((await run(['-q', 'list', 'adapters'], d)).out.split('\n')).toEqual([
      'jest — Jest (CommonJS, TypeScript transpilé)',
      'vitest — Vitest (ESM et CommonJS, TypeScript)',
      'mocha — Mocha (CommonJS)',
      'pytest — Pytest (Python, sonde par plugin)',
      'phpunit — PHPUnit (PHP, sonde par autoload)',
      'junit — JUnit 5 (Java, agent ByteBuddy)',
      'custom — Lanceur externe (commande déclarée dans varia.yml, protocole de sonde)',
    ])
    const s = JSON.parse((await run(['--json', 'list', 'strategies'], d)).out) as { id: string }[]
    expect(s.map((x) => x.id)).toContain('encoding')
    expect((await run(['-q', 'list', 'autre'], d)).code).toBe(3)
  })
})

describe('options', () => {
  it('--quick et --full ensemble ⇒ exit 3 (plus de priorité silencieuse)', async () => {
    const r = await run(['plan', '--quick', '--full'], project())
    expect(r.code).toBe(3)
    expect(r.err).toContain("option '--quick' cannot be used with option '--full'")
  })
  it('config --check : clé inconnue = avertissement traduit, exit 0 (B-05)', async () => {
    const r = await run(['config', '--check'], project({ 'varia.yml': 'version: 1\nbidule: 2\n' }))
    expect(r.code).toBe(0)
    expect(r.err).toContain('Configuration : bidule : clé inconnue, ignorée')
  })
})

describe('db, prune', () => {
  it('db check et db backup (chemin par défaut et --out)', async () => {
    const d = project()
    const data = join(d, '..', `data-${String(Date.now())}`)
    seedRuns(d, data, 1)
    const check = await run(['--data-dir', data, 'db', 'check'], d)
    expect(check.code).toBe(0)
    expect(check.out).toMatch(/^Base intègre : .*varia\.db$/)
    expect(JSON.parse((await run(['--data-dir', data, '--json', 'db', 'check'], d)).out)).toEqual({
      ok: true,
      problems: ['ok'],
    })
    const out = join(data, 'copie.db')
    expect((await run(['--data-dir', data, 'db', 'backup', '--out', out], d)).code).toBe(0)
    expect(existsSync(out)).toBe(true)
    const def = await run(['--data-dir', data, 'db', 'backup'], d)
    expect(def.out).toMatch(/backups[\\/]varia-.*\.db$/)
  })
  it('prune --keep N, défaut retention_runs, valeur invalide ⇒ exit 3', async () => {
    const d = project({ 'varia.yml': 'version: 1\nstorage: { retention_runs: 2 }\n' })
    const data = join(d, '..', `data-${String(Date.now())}`)
    const ids = seedRuns(d, data, 4)
    const def = await run(['--data-dir', data, 'prune'], d)
    expect(def.out).toBe(
      `2 run(s) purgé(s), 2 conservé(s) au plus : ${ids[0] ?? ''}, ${ids[1] ?? ''}`,
    )
    const one = JSON.parse(
      (await run(['--data-dir', data, '--json', 'prune', '--keep', '1'], d)).out,
    )
    expect(one).toEqual({ keep: 1, removed: [ids[2]] })
    expect((await run(['--data-dir', data, 'prune', '--keep', '0'], d)).out).toContain(
      ids[3] ?? '?',
    )
    expect((await run(['--data-dir', data, 'prune'], d)).out).toContain(
      '0 run(s) purgé(s), 2 conservé(s) au plus : —',
    )
    expect((await run(['--data-dir', data, 'prune', '--keep', 'x'], d)).code).toBe(3)
    expect((await run(['--data-dir', data, 'prune', '--keep=-1'], d)).code).toBe(3)
  })
})

describe('oracle suggest (CDC §18.7)', () => {
  const setup = (cfg = 'version: 1\n# commentaire conservé\n') => {
    const d = project({ 'varia.yml': cfg })
    const data = join(
      d,
      '..',
      `data-${String(Date.now())}-${String(Math.floor(performance.now()))}`,
    )
    seedRuns(d, data, 1, ['DomainError', 'DomainError', 'AuthError'])
    return { d, data }
  }
  it('hors terminal : propositions affichées, rien n’est écrit', async () => {
    const { d, data } = setup()
    const r = await run(['--data-dir', data, 'oracle', 'suggest'], d)
    expect(r.out).toContain('DomainError : 2 mutation(s) — ex. « msg DomainError »')
    expect(r.out).toContain('AuthError : 1 mutation(s)')
    expect(r.out).toContain("Aucun classement choisi : rien n'est écrit.")
    expect(readFileSync(join(d, 'varia.yml'), 'utf8')).toBe('version: 1\n# commentaire conservé\n')
    const j = JSON.parse(
      (await run(['--data-dir', data, '--json', 'oracle', 'suggest'], d)).out,
    ) as {
      items: { errorName: string; count: number }[]
    }
    expect(j.items.map((i) => [i.errorName, i.count])).toEqual([
      ['DomainError', 2],
      ['AuthError', 1],
    ])
  })
  it('choix h/c puis confirmation : écrit handled_errors et crash_errors, commentaires conservés', async () => {
    const { d, data } = setup()
    const r = await run(['--data-dir', data, 'oracle', 'suggest'], d, ['h', 'c', 'o'])
    expect(r.asked).toHaveLength(3)
    const yml = readFileSync(join(d, 'varia.yml'), 'utf8')
    expect(yml).toContain('# commentaire conservé')
    expect(yml).toContain('- name: DomainError')
    expect(yml).toMatch(
      /crash_errors:\n {4}- TypeError\n {4}- ReferenceError\n {4}- RangeError\n {4}- AuthError/,
    )
    expect(r.out).toContain('Configuration écrite')
  })
  it('non confirmé : rien n’est écrit ; tout sauté : rien n’est demandé', async () => {
    const { d, data } = setup()
    const r = await run(['--data-dir', data, 'oracle', 'suggest'], d, ['h', 's', 'n'])
    expect(r.out).toContain('Non écrit (non confirmé).')
    expect(readFileSync(join(d, 'varia.yml'), 'utf8')).not.toContain('DomainError')
    const skip = await run(['--data-dir', data, 'oracle', 'suggest'], d, ['s', 's'])
    expect(skip.asked).toHaveLength(2)
  })
  it('sans run ou sans UNEXPECTED_FAILURE : message', async () => {
    const d = project()
    const r = await run(
      ['--data-dir', join(d, '..', `e-${String(Date.now())}`), 'oracle', 'suggest'],
      d,
    )
    expect(r.out).toBe('Aucune UNEXPECTED_FAILURE dans le dernier run.')
  })
})
