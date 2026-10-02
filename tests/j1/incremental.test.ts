// J2 : `--changed` (CDC §29) — portée par git, tests associés par les appels observés, run partiel.
import { execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXAMPLE, json, newDataDir, varia, withReader } from './helpers.js'

interface R {
  run: { partial: boolean }
  incremental: { scope: string; changedFiles: string[] | null } | null
  mutations: { target: string; test: string }[]
}

function copyProject(withGit: boolean): string {
  const d = mkdtempSync(join(tmpdir(), 'varia-inc-'))
  for (const f of ['src', 'tests', 'package.json', 'varia.yml'])
    cpSync(join(EXAMPLE, f), join(d, f), { recursive: true })
  symlinkSync(join(EXAMPLE, 'node_modules'), join(d, 'node_modules'), 'dir')
  if (withGit) {
    const git = (...a: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: d })
    git('init', '-q')
    execFileSync('sh', ['-c', 'echo node_modules > .gitignore'], { cwd: d })
    git('add', '.')
    git('commit', '-qm', 'init')
  }
  return d
}

describe('mode incrémental', () => {
  it('seules les targets/tests touchés sont mutés ; run étiqueté partiel', async () => {
    const d = copyProject(true)
    appendFileSync(join(d, 'src', 'users.js'), '\n// modification\n')
    const r = json<R>(
      await varia(
        // F-02 : périmètre borné (12 mutations), aucune cible qui boucle dans src/users.js.
        [
          '--data-dir',
          newDataDir(),
          '--json',
          'test',
          '--quick',
          '--seed',
          '1',
          '--max-mutations',
          '12',
          '--changed',
        ],
        d,
      ),
    )
    expect(r.incremental).toMatchObject({ scope: 'PARTIAL', changedFiles: ['src/users.js'] })
    expect(r.run.partial).toBe(true)
    expect(r.mutations.length).toBe(12)
    const users = new Set(['src/users.js#createUser', 'src/users.js#fetchUser'])
    expect(r.mutations.every((m) => users.has(m.target))).toBe(true)
  })
  it('sans git : repli complet annoncé (on_unknown: full), run NON partiel (B-10)', async () => {
    const d = copyProject(false)
    const D = newDataDir()
    expect((await varia(['--data-dir', D, '-q', 'plan', '--quick', '--changed'], d)).code).toBe(0)
    const r = json<R>(await varia(['--data-dir', D, 'report'], d))
    expect(r.incremental).toEqual({ base: 'HEAD', changedFiles: null, scope: 'FULL_FALLBACK' })
    // Le repli planifie le périmètre complet : le run n'est pas partiel par le périmètre (B-10) ; le
    // rapport reste partiel tant que les mutations planifiées ne sont pas exécutées.
    expect(withReader(D, (rd) => rd.listRuns(1)[0]?.partial)).toBe(false)
    expect(r.run.partial).toBe(true)
  })
})
