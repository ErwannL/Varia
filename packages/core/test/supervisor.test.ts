// Tests EN PROCESSUS du superviseur (les deux plateformes, par injection) ; son comportement réel
// (groupe de processus tué, code de sortie) est couvert par exec.test.ts dans des processus enfants.
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type Sup = typeof import('../runtime/supervisor.cjs')
const S = createRequire(import.meta.url)('../runtime/supervisor.cjs') as Sup
type Deps = ReturnType<Sup['systemDeps']>

function fake(platform: NodeJS.Platform) {
  const calls: string[] = []
  const status: string[] = []
  let timeout: (() => void) | null = null
  const child = Object.assign(new EventEmitter(), { pid: 77 })
  const deps: Deps = {
    platform,
    spawn: (cmd, args) => {
      calls.push(`spawn ${cmd} ${args.join(' ')}`)
      return child as never
    },
    spawnSync: (cmd, args) => calls.push(`spawnSync ${cmd} ${args.join(' ')}`),
    writeFile: (_f, data) => status.push(data),
    exit: (code) => calls.push(`exit ${code}`),
    kill: (pid, signal) => calls.push(`kill ${pid} ${signal}`),
    stderr: (s) => calls.push(`stderr ${s.trim()}`),
    pid: 500,
    setTimeout: (fn, ms) => {
      calls.push(`timer ${ms}`)
      timeout = fn
      return 't'
    },
    clearTimeout: (t) => calls.push(`clear ${String(t)}`),
  }
  return { deps, calls, status, child, fire: () => timeout?.() }
}

describe('superviseur (CDC §16.2)', () => {
  it('usage incorrect ⇒ code 64, rien n’est lancé', () => {
    for (const argv of [[], ['1', 's', 'x', 'cmd'], ['1', 's', '--'], ['1', '', '--', 'cmd']]) {
      const f = fake('linux')
      S.supervise(argv, f.deps)
      expect(f.calls).toEqual([
        'stderr usage: supervisor.cjs <timeoutMs> <statusFile> -- <command> [args...]',
        'exit 64',
      ])
    }
  })
  it('fin normale : état écrit, code de sortie de la commande (1 si tuée par un signal)', () => {
    const f = fake('linux')
    S.supervise(['250', 's.json', '--', 'node', 'a', 'b'], f.deps)
    f.child.emit('exit', 3, null)
    expect(f.calls).toEqual(['spawn node a b', 'timer 250', 'clear t', 'exit 3'])
    expect(JSON.parse(f.status[0] ?? '')).toEqual({ timedOut: false, exitCode: 3, signal: null })
    const g = fake('linux')
    S.supervise(['250', 's.json', '--', 'node'], g.deps)
    g.child.emit('exit', null, 'SIGTERM')
    expect(g.calls.at(-1)).toBe('exit 1')
  })
  it('timeout POSIX : état « timedOut » puis tout le GROUPE est tué', () => {
    const f = fake('linux')
    S.supervise(['10', 's.json', '--', 'node'], f.deps)
    f.fire()
    expect(JSON.parse(f.status[0] ?? '')).toEqual({ timedOut: true, exitCode: null, signal: null })
    expect(f.calls.slice(2)).toEqual(['kill -500 SIGKILL'])
  })
  it('timeout Windows : `taskkill /T /F` sur l’arbre de l’enfant, sortie 124', () => {
    const f = fake('win32')
    S.supervise(['10', 's.json', '--', 'node'], f.deps)
    f.fire()
    expect(f.calls.slice(2)).toEqual(['spawnSync taskkill /pid 77 /T /F', 'exit 124'])
  })
  it('dépendances système (sans les opérations destructrices)', () => {
    const d = S.systemDeps()
    expect(d.platform).toBe(process.platform)
    expect(d.pid).toBe(process.pid)
    const dir = mkdtempSync(join(tmpdir(), 'varia-sup-'))
    d.writeFile(join(dir, 's'), 'x')
    expect(readFileSync(join(dir, 's'), 'utf8')).toBe('x')
    expect(() => d.spawnSync(process.execPath, ['-e', ''])).not.toThrow()
    d.stderr('')
    // Signal 0 : simple vérification d'existence, sans effet (toute plateforme) ; sous POSIX, la
    // vraie mise à mort du groupe passe par cette dépendance, jamais exécutée sous Windows sinon.
    expect(() => d.kill(process.pid, 0 as unknown as string)).not.toThrow()
    const t = d.setTimeout(() => undefined, 1000)
    d.clearTimeout(t)
    const child = d.spawn(process.execPath, ['-e', ''])
    return new Promise<void>((done) => child.on('exit', () => done()))
  })
})
