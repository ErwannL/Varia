import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  InvalidJob,
  JOB_LIMITS,
  JobRunner,
  jobArgs,
  type JobRequest,
  type JobRunnerOptions,
  type JobView,
} from '../src/index.js'

const code = (req: unknown): string | undefined => {
  try {
    jobArgs(req as JobRequest)
  } catch (e) {
    return e instanceof InvalidJob ? e.code : 'AUTRE'
  }
  return undefined
}

describe('jobArgs : la seule façon de construire la ligne de commande', () => {
  it('baseline, test rapide, test complet', () => {
    expect(jobArgs({ kind: 'baseline' })).toEqual(['baseline'])
    expect(jobArgs({ kind: 'quick' })).toEqual(['test', '--quick'])
    expect(jobArgs({ kind: 'complete' })).toEqual(['test'])
    expect(jobArgs({ kind: 'quick', maxMutations: 50, maxTimeSeconds: 300 })).toEqual([
      'test',
      '--quick',
      '--max-mutations',
      '50',
      '--max-time',
      '300',
    ])
    expect(jobArgs({ kind: 'complete', maxTimeSeconds: 600 })).toEqual([
      'test',
      '--max-time',
      '600',
    ])
  })
  it('type inconnu, paramètres hors bornes ou non entiers ⇒ refus avec un code stable', () => {
    expect(code({ kind: 'rm -rf' })).toBe('INVALID_KIND')
    expect(code({})).toBe('INVALID_KIND')
    for (const bad of [0, -1, 1.5, '5', JOB_LIMITS.maxMutations + 1, Number.NaN, null])
      expect(code({ kind: 'quick', maxMutations: bad }), String(bad)).toBe('INVALID_MAX_MUTATIONS')
    for (const bad of [9, JOB_LIMITS.maxSeconds + 1, 10.5, '60', null])
      expect(code({ kind: 'quick', maxTimeSeconds: bad }), String(bad)).toBe('INVALID_MAX_TIME')
    expect(code({ kind: 'quick', maxMutations: 1, maxTimeSeconds: 10 })).toBeUndefined()
    expect(
      code({ kind: 'quick', maxMutations: JOB_LIMITS.maxMutations, maxTimeSeconds: 86_400 }),
    ).toBeUndefined()
  })
  it('la baseline refuse des paramètres de test (accepté = implémenté)', () => {
    expect(code({ kind: 'baseline', maxMutations: 5 })).toBe('PARAMETERS_NOT_FOR_BASELINE')
    expect(code({ kind: 'baseline', maxTimeSeconds: 60 })).toBe('PARAMETERS_NOT_FOR_BASELINE')
  })
})

/** Faux processus : on le pilote à la main (sortie, erreur, pid). */
class FakeChild extends EventEmitter {
  constructor(readonly pid: number | undefined) {
    super()
  }
}
interface Call {
  bin: string
  args: string[]
  options: { cwd: string; env: NodeJS.ProcessEnv; detached: boolean; stdio: unknown[] }
}

function harness(extra: Partial<JobRunnerOptions> = {}) {
  const calls: Call[] = []
  const children: FakeChild[] = []
  const killed: number[] = []
  let nextPid = 4000
  const logDir = mkdtempSync(join(tmpdir(), 'varia-jobs-'))
  const runner = new JobRunner({
    command: ['node', 'varia.js'],
    globalArgs: ['-C', '/projet', '--lang', 'fr'],
    cwd: '/projet',
    env: { A: '1' },
    logDir,
    info: { name: 'demo', root: '/projet', config: null },
    platform: 'linux',
    kill: (pid) => killed.push(pid),
    now: () => new Date('2026-10-04T10:00:00.000Z'),
    spawn: ((bin: string, args: string[], options: Call['options']) => {
      calls.push({ bin, args, options })
      const child = new FakeChild(nextPid++)
      children.push(child)
      const fd = options.stdio[1] as number
      writeSync(fd, 'sortie du travail\n')
      return child
    }) as unknown as JobRunnerOptions['spawn'],
    ...extra,
  })
  return { runner, calls, children, killed, logDir }
}
const started = (v: JobView | 'BUSY'): JobView => {
  if (v === 'BUSY') throw new Error('BUSY inattendu')
  return v
}

describe('JobRunner (faux processus)', () => {
  it('lance Varia lui-même avec les options globales, dans le projet, sans couleur', () => {
    const h = harness()
    const view = started(h.runner.start({ kind: 'quick', maxMutations: 20 }))
    expect(h.calls[0]).toMatchObject({
      bin: 'node',
      args: [
        'varia.js',
        '-C',
        '/projet',
        '--lang',
        'fr',
        'test',
        '--quick',
        '--max-mutations',
        '20',
      ],
    })
    expect(h.calls[0]?.options).toMatchObject({
      cwd: '/projet',
      detached: true,
      env: { A: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
    })
    expect(h.calls[0]?.options.stdio[0]).toBe('ignore')
    expect(view).toMatchObject({
      kind: 'quick',
      state: 'RUNNING',
      exitCode: null,
      finishedAt: null,
      startedAt: '2026-10-04T10:00:00.000Z',
      command: 'varia test --quick --max-mutations 20',
      log: 'sortie du travail\n',
      logTruncated: false,
    })
    expect(view.id).toMatch(/^j_[0-9a-f]{12}$/)
    expect(h.runner.info()).toEqual({ name: 'demo', root: '/projet', config: null })
  })
  it('Windows : pas de groupe de processus détaché (taskkill /T tue l’arbre)', () => {
    const h = harness({ platform: 'win32' })
    h.runner.start({ kind: 'baseline' })
    expect(h.calls[0]?.options.detached).toBe(false)
  })
  it('un seul travail à la fois ; ensuite on peut relancer', () => {
    const h = harness()
    const first = started(h.runner.start({ kind: 'baseline' }))
    expect(h.runner.start({ kind: 'baseline' })).toBe('BUSY')
    h.children[0]?.emit('exit', 0)
    expect(h.runner.get(first.id)?.state).toBe('DONE')
    expect(started(h.runner.start({ kind: 'baseline' })).id).not.toBe(first.id)
  })
  it('paramètre invalide ⇒ InvalidJob et aucun processus', () => {
    const h = harness()
    expect(() => h.runner.start({ kind: 'quick', maxMutations: 0 })).toThrow(InvalidJob)
    expect(h.calls).toEqual([])
  })
  it.each([
    [0, 'DONE'],
    [1, 'DONE'],
    [2, 'FAILED'],
    [4, 'FAILED'],
    [null, 'FAILED'],
  ] as const)(
    'code de sortie %s ⇒ %s (1 = problèmes de résilience trouvés, le travail est allé au bout)',
    (exit, state) => {
      const h = harness()
      const { id } = started(h.runner.start({ kind: 'complete' }))
      h.children[0]?.emit('exit', exit)
      const view = h.runner.get(id)
      expect(view).toMatchObject({ state, exitCode: exit, finishedAt: '2026-10-04T10:00:00.000Z' })
    },
  )
  it('une fin signalée deux fois ne change rien', () => {
    const h = harness()
    const { id } = started(h.runner.start({ kind: 'baseline' }))
    h.children[0]?.emit('exit', 0)
    h.children[0]?.emit('error', new Error('tard'))
    expect(h.runner.get(id)).toMatchObject({ state: 'DONE', exitCode: 0 })
  })
  it('annulation : tout l’arbre est tué, état CANCELED (même si le code de sortie est non nul)', () => {
    const h = harness()
    const { id } = started(h.runner.start({ kind: 'quick' }))
    expect(h.runner.cancel(id)?.state).toBe('RUNNING')
    expect(h.killed).toEqual([4000])
    h.children[0]?.emit('exit', null)
    expect(h.runner.get(id)).toMatchObject({ state: 'CANCELED', exitCode: null })
  })
  it('annuler un travail fini, ou inconnu : aucun processus tué', () => {
    const h = harness()
    const { id } = started(h.runner.start({ kind: 'baseline' }))
    h.children[0]?.emit('exit', 0)
    expect(h.runner.cancel(id)?.state).toBe('DONE')
    expect(h.runner.cancel('j_inconnu')).toBeNull()
    expect(h.runner.get('j_inconnu')).toBeNull()
    expect(h.killed).toEqual([])
  })
  it('annuler avant que le processus existe (pas de pid) : marqué annulé sans rien tuer', () => {
    const h = harness({
      spawn: (() => new FakeChild(undefined)) as unknown as JobRunnerOptions['spawn'],
    })
    const { id } = started(h.runner.start({ kind: 'baseline' }))
    h.runner.cancel(id)
    expect(h.killed).toEqual([])
  })
  it('échec du lancement (événement error) : FAILED et message dans le journal', () => {
    const h = harness()
    const { id } = started(h.runner.start({ kind: 'baseline' }))
    h.children[0]?.emit('error', new Error('spawn ENOENT'))
    const view = h.runner.get(id)
    expect(view?.state).toBe('FAILED')
    expect(view?.log).toContain('spawn ENOENT')
  })
  it('échec SYNCHRONE du lancement : FAILED tout de suite, jamais « en cours » pour toujours', () => {
    const h = harness({
      spawn: (() => {
        throw new Error('EPERM')
      }) as unknown as JobRunnerOptions['spawn'],
    })
    const view = started(h.runner.start({ kind: 'baseline' }))
    expect(view).toMatchObject({ state: 'FAILED', exitCode: null })
    expect(view.log).toContain('EPERM')
    expect(h.runner.start({ kind: 'baseline' })).not.toBe('BUSY')
  })
  it('journal : seule la FIN est rendue, avec le drapeau de troncature', () => {
    const h = harness({
      spawn: ((_b: string, _a: string[], options: Call['options']) => {
        writeSync(options.stdio[1] as number, 'début\n' + 'x'.repeat(JOB_LIMITS.logTailBytes))
        return new FakeChild(1)
      }) as unknown as JobRunnerOptions['spawn'],
    })
    const view = started(h.runner.start({ kind: 'baseline' }))
    expect(view.logTruncated).toBe(true)
    expect(view.log).toHaveLength(JOB_LIMITS.logTailBytes)
    expect(view.log.startsWith('début')).toBe(false)
  })
  it('liste du plus récent au plus ancien ; seuls les 10 derniers sont gardés (journaux supprimés)', () => {
    const h = harness()
    const ids: string[] = []
    for (let i = 0; i < JOB_LIMITS.keep + 2; i += 1) {
      ids.push(started(h.runner.start({ kind: 'baseline' })).id)
      h.children[i]?.emit('exit', 0)
    }
    const listed = h.runner.list().map((j) => j.id)
    expect(listed).toEqual(ids.slice(2).reverse())
    expect(readdirSync(h.logDir)).toHaveLength(JOB_LIMITS.keep)
    expect(h.runner.get(ids[0] ?? '')).toBeNull()
  })
  it('fermeture : le travail en cours est tué, les journaux supprimés', () => {
    const h = harness()
    started(h.runner.start({ kind: 'baseline' }))
    h.runner.close()
    expect(h.killed).toEqual([4000])
    expect(existsSync(h.logDir)).toBe(false)
  })
  it('fermeture : un travail déjà fini, ou sans pid, n’est pas tué', () => {
    const h = harness()
    started(h.runner.start({ kind: 'baseline' }))
    h.children[0]?.emit('exit', 0)
    h.runner.close()
    expect(h.killed).toEqual([])
    const sans = harness({
      spawn: (() => new FakeChild(undefined)) as unknown as JobRunnerOptions['spawn'],
    })
    sans.runner.start({ kind: 'baseline' })
    sans.runner.close()
    expect(sans.killed).toEqual([])
  })
})

describe('JobRunner (vrais processus)', () => {
  const script = (body: string) => {
    const file = join(mkdtempSync(join(tmpdir(), 'varia-job-script-')), 'varia.js')
    writeFileSync(file, body)
    return file
  }
  const real = (body: string) =>
    new JobRunner({
      command: [process.execPath, script(body)],
      globalArgs: ['--lang', 'fr'],
      cwd: tmpdir(),
      env: process.env,
      logDir: mkdtempSync(join(tmpdir(), 'varia-jobs-real-')),
      info: { name: 'x', root: tmpdir(), config: '/c.yml' },
    })
  const until = async (fn: () => boolean, ms = 15_000) => {
    const end = Date.now() + ms
    while (!fn()) {
      if (Date.now() > end) throw new Error('délai dépassé')
      await new Promise((ok) => setTimeout(ok, 50))
    }
  }

  it('un travail réel : arguments reçus, sortie capturée, code 1 = DONE', async () => {
    const runner = real("console.log(process.argv.slice(2).join(' ')); process.exit(1)")
    const { id } = started(runner.start({ kind: 'quick', maxMutations: 7 }))
    await until(() => runner.get(id)?.state !== 'RUNNING')
    const view = runner.get(id)
    expect(view).toMatchObject({ state: 'DONE', exitCode: 1 })
    expect(view?.log.trim()).toBe('--lang fr test --quick --max-mutations 7')
    runner.close()
  })
  it('annulation réelle : le processus et son arbre s’arrêtent', async () => {
    const runner = real('setInterval(() => {}, 1000)')
    const { id } = started(runner.start({ kind: 'baseline' }))
    expect(runner.get(id)?.state).toBe('RUNNING')
    runner.cancel(id)
    await until(() => runner.get(id)?.state !== 'RUNNING')
    expect(runner.get(id)?.state).toBe('CANCELED')
    runner.close()
  })
})
