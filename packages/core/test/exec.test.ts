import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  groupAlive,
  killTree,
  runSupervised,
  statusFileIn,
  waitGroupGone,
} from '../src/exec/proc.js'
import { diffSnapshots, manifestSnapshot } from '../src/integrity.js'
import { projectDataDir, userDataDir } from '../src/paths.js'
import { globToRegExpSource } from '../src/glob.js'

const dir = () => mkdtempSync(join(tmpdir(), 'varia-core-'))
const node = (code: string, timeoutMs = 5000) => {
  const d = dir()
  return runSupervised(process.execPath, ['-e', code], {
    cwd: d,
    env: process.env,
    timeoutMs,
    statusFile: statusFileIn(d),
  })
}

describe('exécution supervisée (CDC §16.2)', () => {
  it('code de sortie et sorties capturées', async () => {
    const r = await node(
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
    )
    expect([r.exitCode, r.timedOut, r.stdout, r.stderr]).toEqual([3, false, 'out', 'err'])
  })
  it('timeout : boucle infinie tuée avec son arbre', async () => {
    const t0 = performance.now()
    const r = await node(
      'require("child_process").spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]); for(;;){}',
      800,
    )
    expect(r.timedOut).toBe(true)
    expect(performance.now() - t0).toBeLessThan(5000)
    if (process.platform !== 'win32') {
      expect(await waitGroupGone(r.pid ?? -1)).toBe(true)
      expect(groupAlive(r.pid ?? -1)).toBe(false)
    }
  })
  it('sortie plafonnée et marquée', async () => {
    const d = dir()
    const r = await runSupervised(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(100000))'],
      {
        cwd: d,
        env: process.env,
        timeoutMs: 5000,
        statusFile: statusFileIn(d),
        maxOutputBytes: 1000,
      },
    )
    expect(r.outputTruncated).toBe(true)
    expect(r.stdout.length).toBeLessThanOrEqual(1000)
  })
  it('killTree Windows : taskkill /T /F (implémentation testée hors Windows)', () => {
    const run = vi.fn()
    killTree(1234, 'win32', run as never)
    expect(run).toHaveBeenCalledWith('taskkill', ['/pid', '1234', '/T', '/F'], { stdio: 'ignore' })
  })
  it('killTree POSIX sur un groupe inexistant ne lève pas', () => {
    expect(() => killTree(2 ** 22 + 12345, 'linux')).not.toThrow()
  })
})

describe('intégrité sans git (CDC §5)', () => {
  it('détecte ajout, modification, suppression ; ignore node_modules et les dossiers déclarés', () => {
    const d = dir()
    writeFileSync(join(d, 'a.txt'), 'a')
    mkdirSync(join(d, 'node_modules'))
    mkdirSync(join(d, 'coverage'))
    const before = manifestSnapshot(d, ['coverage'])
    writeFileSync(join(d, 'a.txt'), 'b')
    writeFileSync(join(d, 'new.txt'), 'n')
    writeFileSync(join(d, 'node_modules', 'x'), 'x')
    writeFileSync(join(d, 'coverage', 'x'), 'x')
    expect(diffSnapshots(before, manifestSnapshot(d, ['coverage']))).toEqual(['a.txt', 'new.txt'])
  })
})

describe('chemins et motifs', () => {
  it('répertoire de données par plateforme', () => {
    expect(userDataDir({ LOCALAPPDATA: 'C:\\L' }, 'win32', '/h')).toBe('C:\\L')
    expect(userDataDir({}, 'darwin', '/h')).toBe(join('/h', 'Library', 'Application Support'))
    expect(userDataDir({ XDG_DATA_HOME: '/x' }, 'linux', '/h')).toBe('/x')
    expect(userDataDir({}, 'linux', '/h')).toBe(join('/h', '.local', 'share'))
    expect(projectDataDir('/p/app', '/d')).toMatch(/projects[/\\]app-[0-9a-f]{12}$/)
    expect(projectDataDir('/p/app')).toContain(join('varia', 'projects', 'app-'))
    expect(userDataDir({}, 'win32', '/h')).toBe(join('/h', 'AppData', 'Local'))
  })
  it('glob', () => {
    const re = (g: string) => new RegExp(globToRegExpSource(g))
    expect(re('src/**').test('src/a/b.js')).toBe(true)
    expect(re('src/*.js').test('src/a/b.js')).toBe(false)
    expect(re('src/**/x.ts').test('src/x.ts')).toBe(true)
    expect(re('a?.js').test('ab.js')).toBe(true)
    expect(re('a.js').test('abjs')).toBe(false)
  })
})
