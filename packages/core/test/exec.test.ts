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
  it('timeout : boucle infinie tuée avec son arbre (toutes plateformes)', async () => {
    const t0 = performance.now()
    // Le petit-enfant annonce son pid par une écriture SYNCHRONE (fd 1), puis le parent boucle.
    const r = await node(
      'const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]); require("fs").writeSync(1, String(c.pid)); for(;;){}',
      800,
    )
    expect(r.timedOut).toBe(true)
    expect(performance.now() - t0).toBeLessThan(5000)
    const grandchild = Number(r.stdout)
    expect(grandchild).toBeGreaterThan(0)
    expect(await waitGroupGone(r.pid ?? -1)).toBe(true)
    expect(groupAlive(r.pid ?? -1, process.platform)).toBe(false)
    // Arbre mort : le petit-enfant lui-même n'existe plus, quelle que soit la plateforme.
    let alive = true
    for (let i = 0; i < 50 && alive; i++) {
      try {
        process.kill(grandchild, 0)
        await new Promise((r) => setTimeout(r, 100))
      } catch {
        alive = false
      }
    }
    expect(alive).toBe(false)
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
  it('sortie au-delà de la limite : l’arbre est ARRÊTÉ (pas un timeout), sortie marquée (A-03)', async () => {
    const d = dir()
    const t0 = performance.now()
    const r = await runSupervised(
      process.execPath,
      // Écritures cédant la main : sous macOS, un tube est asynchrone et une boucle synchrone
      // infinie ne viderait jamais son tampon (aucune sortie observée, faux TIMEOUT).
      ['-e', 'setInterval(() => process.stdout.write("x".repeat(65536)), 1)'],
      {
        cwd: d,
        env: process.env,
        timeoutMs: 20000,
        statusFile: statusFileIn(d),
        maxOutputBytes: 100000,
      },
    )
    expect([r.outputTruncated, r.timedOut]).toEqual([true, false])
    expect(performance.now() - t0).toBeLessThan(10000)
  })
  it('plateforme Windows injectée : pas de groupe détaché, pas de nettoyage de groupe (G-06)', async () => {
    const d = dir()
    const r = await runSupervised(process.execPath, ['-e', 'process.stdout.write("w")'], {
      cwd: d,
      env: process.env,
      timeoutMs: 5000,
      statusFile: statusFileIn(d),
      platform: 'win32',
    })
    expect([r.exitCode, r.stdout]).toEqual([0, 'w'])
  })
  it('killTree Windows : taskkill /T /F (implémentation testée hors Windows)', () => {
    const run = vi.fn()
    killTree(1234, 'win32', run as never)
    expect(run).toHaveBeenCalledWith('taskkill', ['/pid', '1234', '/T', '/F'], { stdio: 'ignore' })
  })
  it('échec du lancement (cwd absent) : promesse rejetée', async () => {
    const d = dir()
    await expect(
      runSupervised(process.execPath, ['-e', '0'], {
        cwd: join(d, 'absent'),
        env: process.env,
        timeoutMs: 1000,
        statusFile: statusFileIn(d),
      }),
    ).rejects.toThrow()
  })
  it('waitGroupGone : attend un groupe vivant, rend false à l’échéance puis true après kill', async () => {
    const { spawn } = await import('node:child_process')
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      detached: process.platform !== 'win32',
      stdio: 'ignore',
    })
    const pid = child.pid ?? -1
    const exited = new Promise((r) => child.on('exit', r))
    expect(groupAlive(pid)).toBe(true)
    expect(await waitGroupGone(pid, 60)).toBe(false)
    killTree(pid)
    await exited
    expect(await waitGroupGone(pid, 5000)).toBe(true)
  })
  it('groupAlive Windows : teste le processus lui-même (pas de groupe)', () => {
    expect(groupAlive(process.pid, 'win32')).toBe(true)
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
