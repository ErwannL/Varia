import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const scripts = resolve('scripts')

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'varia-q-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

function run(script: string, cwd: string): number {
  return (
    spawnSync(process.execPath, [join(scripts, script)], { cwd, encoding: 'utf8' }).status ?? -1
  )
}

describe('check-skipped-tests', () => {
  it('échoue sur un test sauté', () => {
    expect(
      run('check-skipped-tests.mjs', repo({ 'a.test.ts': `it.${'skip'}('x', () => {})\n` })),
    ).toBe(1)
  })
  it('échoue sur un test isolé', () => {
    expect(
      run('check-skipped-tests.mjs', repo({ 'a.test.ts': `test.${'only'}('x', () => {})\n` })),
    ).toBe(1)
  })
  it('passe sur des tests normaux', () => {
    expect(run('check-skipped-tests.mjs', repo({ 'a.test.ts': "it('x', () => {})\n" }))).toBe(0)
  })
})

describe('check-file-lines', () => {
  it('échoue au-delà de 1000 lignes', () => {
    expect(run('check-file-lines.mjs', repo({ 'big.ts': 'x\n'.repeat(1000) }))).toBe(1)
  })
  it('passe à 1000 lignes', () => {
    expect(run('check-file-lines.mjs', repo({ 'ok.ts': 'x\n'.repeat(999) }))).toBe(0)
  })
})

describe('check-readmes', () => {
  it('échoue sur un dossier sans README', () => {
    expect(run('check-readmes.mjs', repo({ 'src/a.ts': '' }))).toBe(1)
  })
  it('passe quand chaque dossier a son README', () => {
    expect(run('check-readmes.mjs', repo({ 'src/a.ts': '', 'src/README.md': '' }))).toBe(0)
  })
})

describe('check-coverage-ignores', () => {
  const ign = (tool: string) => `/* ${tool} ${'ignore'} next */\nconst a = 1\n`
  it.each(['v8', 'c8', 'istanbul'])('échoue sur un commentaire %s', (tool) => {
    expect(run('check-coverage-ignores.mjs', repo({ 'src/a.ts': ign(tool) }))).toBe(1)
  })
  it('échoue sur un contact avec le compteur global', () => {
    const code = `globalThis.${'__cov' + 'erage__'} = {}\n`
    expect(run('check-coverage-ignores.mjs', repo({ 'src/a.js': code }))).toBe(1)
  })
  it('passe sur du code propre et ignore la documentation', () => {
    expect(
      run(
        'check-coverage-ignores.mjs',
        repo({ 'src/a.ts': 'export const a = 1\n', 'n.md': ign('v8') }),
      ),
    ).toBe(0)
  })
})
