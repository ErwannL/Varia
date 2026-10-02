// B-10 : l'étiquette « partiel » suit le fait (périmètre réellement réduit), pas l'intention.
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { changedFiles, planRun, runBaseline } from '../src/index.js'
import { context, project, scripted } from './fake.js'

const TESTS = [
  { name: 'a', file: 'tests/a.test.js', calls: [{ module: 'src/a.js', args: [1] }] },
  { name: 'b', file: 'tests/b.test.js', calls: [{ module: 'src/b.js', args: [2] }] },
]

function gitProject(
  yml = "version: 1\nmutations: { seed: 1, per_input: 1, strategies: ['null'] }\n",
) {
  const root = project(yml)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.js'), '// a\n')
  writeFileSync(join(root, 'src', 'b.js'), '// b\n')
  writeFileSync(join(root, '.gitignore'), '.data\n')
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: root })
  git('init', '-q')
  git('add', '.')
  git('commit', '-qm', 'init')
  return root
}

async function planChanged(root: string, partialBaseline = false) {
  const ctx = context(scripted(TESTS), undefined, root)
  const b = await runBaseline(ctx, { force: partialBaseline })
  planRun(ctx, b.runId, { changed: 'HEAD' })
  const run = ctx.reader.getRun(b.runId)
  ctx.close()
  return run
}

describe('--changed (CDC §29, B-10)', () => {
  it('périmètre réduit ⇒ PARTIAL, run partiel', async () => {
    const root = gitProject()
    appendFileSync(join(root, 'src', 'a.js'), '// modifié\n')
    const run = await planChanged(root)
    expect(run?.info['incremental']).toMatchObject({ scope: 'PARTIAL', changedFiles: ['src/a.js'] })
    expect(run?.partial).toBe(true)
  })
  it('filtre qui garde TOUT ⇒ FULL, run complet', async () => {
    const root = gitProject()
    appendFileSync(join(root, 'src', 'a.js'), '// modifié\n')
    appendFileSync(join(root, 'src', 'b.js'), '// modifié\n')
    const run = await planChanged(root)
    expect(run?.info['incremental']).toMatchObject({ scope: 'FULL' })
    expect(run?.partial).toBe(false)
  })
  it('sans git : repli complet annoncé, run NON partiel', async () => {
    const root = project("version: 1\nmutations: { seed: 1, per_input: 1, strategies: ['null'] }\n")
    expect(changedFiles(root).files).toBeNull()
    const run = await planChanged(root)
    expect(run?.info['incremental']).toEqual({
      base: 'HEAD',
      changedFiles: null,
      scope: 'FULL_FALLBACK',
    })
    expect(run?.partial).toBe(false)
  })
})
