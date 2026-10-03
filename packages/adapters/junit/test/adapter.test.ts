// Adaptateur JUnit RÉEL (R-04) : préparation hors du projet (Maven hors ligne, javac dans le dossier
// temporaire), console JUnit + agent Java sur examples/junit-project ; erreurs de préparation par
// commandes injectées.
import type { PrepareContext } from '@varia/core'
import { manifestSnapshot, diffSnapshots } from '@varia/core'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AGENT_DIR,
  JUNIT_CAPABILITIES,
  JUnitAdapter,
  javaFiles,
  sourceRoots,
  spawnExec,
  targetClasses,
  type Exec,
} from '../src/adapter.js'

const EXAMPLE = resolve('examples/junit-project')
const tmp = (p: string) => mkdtempSync(join(tmpdir(), `varia-junit-${p}-`))
const ctxFor = (root: string, extra: Partial<PrepareContext> = {}): PrepareContext => ({
  root,
  tmpDir: tmp('prep'),
  runId: 'r1',
  include: ['src/main/java/**'],
  exclude: [],
  redact: { fields: ['password'], patterns: [], skipPaths: [], hmacKey: 'k' },
  ...extra,
})

describe('adaptateur JUnit : fonctions pures', () => {
  it('capacités déclarées (copie)', () => {
    const a = new JUnitAdapter()
    expect(a.capabilities()).toEqual(JUNIT_CAPABILITIES)
    expect(a.capabilities()).not.toBe(JUNIT_CAPABILITIES)
    expect(a.id).toBe('junit')
  })

  it('detect : version de junit-jupiter dans le pom, sinon RUNNER_NOT_FOUND', async () => {
    expect(await new JUnitAdapter().detect(EXAMPLE)).toEqual({
      detected: true,
      framework: 'junit',
      version: '5.11.4',
      nativeEsm: false,
      reasons: [],
    })
    const none = await new JUnitAdapter().detect(tmp('vide'))
    expect([none.detected, none.version, none.reasons]).toEqual([false, null, ['RUNNER_NOT_FOUND']])
  })

  it('racines des sources, fichiers .java, classes ciblées', () => {
    expect(sourceRoots('<project/>')).toEqual({ main: 'src/main/java', test: 'src/test/java' })
    expect(
      sourceRoots(
        '<sourceDirectory>${project.basedir}/app</sourceDirectory><testSourceDirectory> t </testSourceDirectory>',
      ),
    ).toEqual({ main: 'app', test: 't' })
    expect(javaFiles(join(EXAMPLE, 'absent'))).toEqual([])
    const mixed = tmp('mixed')
    writeFileSync(join(mixed, 'A.java'), '')
    writeFileSync(join(mixed, 'notes.txt'), '')
    expect(javaFiles(mixed)).toEqual([join(mixed, 'A.java')])
    const classes = targetClasses(EXAMPLE, 'src/main/java', ['src/**'], ['**/Notify.java'])
    expect(classes['com.example.Users']).toBe('src/main/java/com/example/Users.java')
    expect(classes['com.example.Notify']).toBeUndefined()
    expect(Object.keys(classes)).toHaveLength(6)
    expect(targetClasses(EXAMPLE, 'src/main/java', ['autre/**'], [])).toEqual({})
  })
})

describe('adaptateur JUnit : préparation', () => {
  it('run avant prepare : erreur explicite', async () => {
    await expect(
      new JUnitAdapter().run({ mode: 'observe', runDir: tmp('r'), timeoutMs: 1000 }),
    ).rejects.toThrow('prepare()')
  })

  it('jar de l’agent absent : JUNIT_AGENT_NOT_BUILT', async () => {
    await expect(
      new JUnitAdapter({ agentDir: tmp('agent') }).prepare(ctxFor(EXAMPLE)),
    ).rejects.toThrow('JUNIT_AGENT_NOT_BUILT')
  })

  it('Maven ou javac en échec : erreur avec la sortie de la commande', async () => {
    const fail: Exec = () => ({ status: 1, stdout: 'out', stderr: 'err ' })
    await expect(new JUnitAdapter({ exec: fail }).prepare(ctxFor(EXAMPLE))).rejects.toThrow(
      /MAVEN_CLASSPATH_FAILED: mvn -o\nerr out/,
    )
    const calls: string[][] = []
    const javacFails: Exec = (cmd, args) => {
      calls.push([cmd, ...args])
      if (cmd === 'javac') return { status: 2, stdout: '', stderr: 'erreur de compilation' }
      writeFileSync(
        (args.find((a) => a.startsWith('-Dmdep.outputFile=')) ?? '').slice(18),
        '/x/y.jar',
      )
      return { status: 0, stdout: '', stderr: '' }
    }
    await expect(new JUnitAdapter({ exec: javacFails }).prepare(ctxFor(EXAMPLE))).rejects.toThrow(
      'JAVAC_FAILED',
    )
    expect(calls.map((c) => c[0])).toEqual(['mvn', 'javac'])
    // Projet sans sources ni dépendances : rien à compiler, aucune commande javac.
    const empty = tmp('empty')
    writeFileSync(join(empty, 'pom.xml'), '<project/>')
    calls.length = 0
    await new JUnitAdapter({ exec: javacFails }).prepare(ctxFor(empty))
    expect(calls.map((c) => c[0])).toEqual(['mvn'])
    const noArgs: Exec = () => ({ status: 3, stdout: '', stderr: '' })
    expect(() =>
      (
        new JUnitAdapter({ exec: noArgs }) as unknown as {
          run1: (c: string, a: string[], d: string, k: string) => string
        }
      ).run1('x', [], empty, 'K'),
    ).toThrow('K: x')
  })

  it('commandes réelles : shell seulement sous Windows (script .cmd)', () => {
    expect(spawnExec('linux')('node', ['-e', 'process.stdout.write("ok")'], '.')).toEqual({
      status: 0,
      stdout: 'ok',
      stderr: '',
    })
    expect(spawnExec('win32')('node', ['-e', '1'], '.').status).toBe(0)
  })

  it('commande par défaut (spawnSync) : commande introuvable ⇒ échec Maven', async () => {
    await expect(
      new JUnitAdapter({ mvn: 'varia-mvn-introuvable' }).prepare(ctxFor(EXAMPLE)),
    ).rejects.toThrow('MAVEN_CLASSPATH_FAILED')
  })
})

describe('adaptateur JUnit : exécution réelle (agent Java + console JUnit)', () => {
  it('observation complète, sélection d’une itération, projet inchangé', async () => {
    const before = manifestSnapshot(EXAMPLE)
    const a = new JUnitAdapter()
    const ctx = ctxFor(EXAMPLE, { memoryMb: 512, env: { VARIA_PARASITE: '1', TZ: 'UTC' } })
    await a.prepare(ctx)
    // Variables VARIA_* héritées de l'appelant : jamais transmises (seules celles de la sonde).
    process.env['VARIA_HERITEE'] = '1'
    const agentCfg = JSON.parse(readFileSync(join(ctx.tmpDir, 'junit-agent.json'), 'utf8')) as {
      classes: Record<string, string>
      testRoots: string[]
    }
    expect(agentCfg.testRoots).toEqual(['src/test/java'])
    const runDir = join(ctx.tmpDir, 'observe')
    mkdirSync(runDir)
    const run = await a.run({
      mode: 'observe',
      runDir,
      timeoutMs: 120_000,
      maxOutputBytes: 1 << 20,
    })
    expect(run.process.exitCode).toBe(0)
    expect(run.tests?.length).toBe(13)
    expect(run.tests?.every((t) => t.status === 'passed')).toBe(true)
    expect(run.events.filter((e) => e.type === 'HELLO')).toHaveLength(1)
    const created = run.events.filter((e) => e.type === 'OBSERVE_CALL' && e.export === 'createUser')
    expect(created).toHaveLength(7)
    // Les identités des tests (rapport) sont celles de la sonde (TEST_START).
    const starts = new Set(run.events.filter((e) => e.type === 'TEST_START').map((e) => e.testId))
    expect(run.tests?.every((t) => starts.has(t.testId))).toBe(true)
    expect(
      readFileSync(join(runDir, `probe-${String(run.events[0]?.pid)}.jsonl`), 'utf8'),
    ).not.toContain('hunter2')
    const sel = join(ctx.tmpDir, 'sel')
    mkdirSync(sel)
    const one = await a.run({
      mode: 'observe',
      runDir: sel,
      timeoutMs: 120_000,
      testFile: 'src/test/java/com/example/UsersTest.java',
      testName: 'com.example.UsersTest#accepts(java.lang.String, int) [2]',
      env: { EXTRA: '1' },
    })
    expect(one.tests?.map((t) => t.name)).toEqual([
      'com.example.UsersTest#accepts(java.lang.String, int) [2]',
    ])
    expect(diffSnapshots(before, manifestSnapshot(EXAMPLE))).toEqual([])
    expect(AGENT_DIR.endsWith(join('junit', 'agent', 'target'))).toBe(true)
  })

  it('processus tué (délai dépassé) : aucun résultat de test', async () => {
    const a = new JUnitAdapter()
    const ctx = ctxFor(EXAMPLE)
    await a.prepare(ctx)
    const runDir = join(ctx.tmpDir, 'to')
    mkdirSync(runDir)
    const r = await a.run({
      mode: 'observe',
      runDir,
      timeoutMs: 50,
      planPath: '/x',
      mutationId: 'm',
    })
    expect([r.process.timedOut, r.tests]).toEqual([true, null])
  })
})
