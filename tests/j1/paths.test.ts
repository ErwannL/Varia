// Racine atteinte par un lien symbolique (`/var` → `/private/var` sous macOS, noms courts sous
// Windows) : la sonde et git rapportent des chemins réels ; Varia doit canoniser la racine.
import { execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXAMPLE, json, newDataDir, varia } from './helpers.js'

interface R {
  incremental: { scope: string; changedFiles: string[] | null } | null
  mutations: { target: string }[]
}

describe('racine non canonique', () => {
  it('projet ouvert par un lien symbolique : cibles observées et --changed exact', async () => {
    const real = mkdtempSync(join(tmpdir(), 'varia-real-'))
    for (const f of ['src', 'tests', 'package.json', 'varia.yml'])
      cpSync(join(EXAMPLE, f), join(real, f), { recursive: true })
    symlinkSync(join(EXAMPLE, 'node_modules'), join(real, 'node_modules'), 'dir')
    const git = (...a: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: real })
    git('init', '-q')
    appendFileSync(join(real, '.gitignore'), 'node_modules\n')
    git('add', '.')
    git('commit', '-qm', 'init')
    appendFileSync(join(real, 'src', 'users.js'), '\n// modification\n')
    const link = join(mkdtempSync(join(tmpdir(), 'varia-link-')), 'p')
    symlinkSync(real, link, 'junction')
    const r = json<R>(
      await varia(
        [
          '--data-dir',
          newDataDir(),
          '--json',
          'test',
          '--quick',
          '--seed',
          '1',
          '--max-mutations',
          '4',
          '--changed',
        ],
        link,
      ),
    )
    expect(r.incremental).toMatchObject({ scope: 'PARTIAL', changedFiles: ['src/users.js'] })
    expect(r.mutations.length).toBeGreaterThan(0)
  })
})
