// Tests EN PROCESSUS de la sonde (F-03) : la sonde est chargée par `require` dans le processus de test,
// avec un état injecté (journal en mémoire), sans Jest ni Vitest du projet cible.
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProbeEvent } from '@varia/probe-protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { callSiteIdOf, fingerprint, serializeArgs, testIdOf } from '../src/index.js'

type ProbeModule = typeof import('../runtime/probe.cjs')
type State = NonNullable<ReturnType<ProbeModule['internals']['init']>>
type Ev = ProbeEvent & { reason?: string; chain?: number[] }

const req = createRequire(import.meta.url)
const probe = req('../runtime/probe.cjs') as ProbeModule
const P = probe.internals
const asyncHooks = req('node:async_hooks') as object
const g = globalThis as unknown as { __varia: State | null }

type FakeGlobal = {
  __varia?: State | null
  beforeEach?: unknown
  afterEach?: unknown
  expect?: unknown
}

function must<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error('valeur attendue')
  return x
}
const tid = (st: State) => must(st.currentTest).testId
/** Enveloppe une fonction quelconque (les cibles réelles n'ont pas de type). */
const wrap = (st: State, fn: (...a: never[]) => unknown, m: string, e: string) =>
  P.wrapFunction(st, fn, m, e) as (...a: unknown[]) => unknown

function state(env: Record<string, string> = {}, files: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'varia-probe-'))
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(dir, name), JSON.stringify(content))
  const st = must(
    P.init({
      VARIA_MODE: 'observe',
      VARIA_RUN_DIR: dir,
      ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.replace('<dir>', dir)])),
    }),
  )
  const lines: Ev[] = []
  st.write = (line: string) => lines.push(JSON.parse(line))
  st.now = () => 'T'
  g.__varia = st
  return { st, lines, dir }
}

const startTest = (st: State, name = 'a test', file = 'tests/a.test.js') => {
  st.currentTest = { testId: testIdOf(file, name, 0), file, name }
  st.sequences = new Map()
}
const ofType = (lines: Ev[], type: string) => lines.filter((l) => l.type === type)

afterEach(() => {
  g.__varia = null
})

describe('init (CDC D.0)', () => {
  it('hors d’un run Varia : aucun état', () => {
    expect(P.init({})).toBeNull()
    // Écriture sur stderr par défaut (marqueur d'erreur de sonde).
    const dir = mkdtempSync(join(tmpdir(), 'varia-probe-'))
    expect(() =>
      must(P.init({ VARIA_MODE: 'observe', VARIA_RUN_DIR: dir })).stderr(''),
    ).not.toThrow()
    expect(P.init({ VARIA_MODE: 'observe' })).toBeNull()
    expect(P.init({ VARIA_MODE: 'other', VARIA_RUN_DIR: '/x' })).toBeNull()
  })
  it('lit cibles, redaction et la mutation visée du plan', () => {
    const mutation = {
      id: 'm_1',
      callSiteId: 'c',
      argsFingerprint: 'f',
      path: ['0'],
      op: 'set',
      value: 1,
    }
    const { st } = state(
      {
        VARIA_MODE: 'fuzz',
        VARIA_TARGETS: '<dir>/t.json',
        VARIA_REDACT: '<dir>/r.json',
        VARIA_PLAN: '<dir>/p.json',
        VARIA_MUTATION_ID: 'm_1',
      },
      {
        't.json': { runId: 'r_1', projectRoot: '/p' },
        'r.json': { fields: ['Password'], patterns: ['^tok'], skipPaths: ['f#arg0'], hmacKey: 'k' },
        'p.json': { mutations: [{ ...mutation, id: 'm_0' }, mutation] },
      },
    )
    expect(st.runId).toBe('r_1')
    expect(st.projectRoot).toBe('/p')
    expect([...st.redactFields]).toEqual(['password'])
    expect(must(st.redactPatterns[0]).test('TOKEN')).toBe(true)
    expect(st.skipPaths).toEqual(['f#arg0'])
    expect(st.hmacKey).toBe('k')
    expect(st.mutation).toEqual(mutation)
  })
  it('valeurs par défaut ; plan sans la mutation ; journal réel sur disque', () => {
    const dir = mkdtempSync(join(tmpdir(), 'varia-probe-'))
    writeFileSync(join(dir, 'p.json'), JSON.stringify({}))
    const st = must(
      P.init({ VARIA_MODE: 'fuzz', VARIA_RUN_DIR: dir, VARIA_PLAN: join(dir, 'p.json') }),
    )
    expect(st.mutation).toBeNull()
    expect(st.runId).toBe('')
    expect(st.projectRoot).toBe(process.cwd())
    expect(st.hmacKey).toBe('varia')
    P.emit(st, 'HELLO', { pid: 1 })
    const line = JSON.parse(readFileSync(st.logFile, 'utf8'))
    expect(line).toMatchObject({ protocolVersion: 1, type: 'HELLO', testId: null, pid: 1 })
    expect(Number.isNaN(Date.parse(line.timestamp))).toBe(false)
    expect(must(P.init({ VARIA_MODE: 'fuzz', VARIA_RUN_DIR: dir })).mutation).toBeNull()
  })
})

describe('observation d’un appel', () => {
  it('arguments, empreinte, call site, issue retournée ; rang par target et par test', () => {
    const { st, lines } = state()
    startTest(st)
    const f = wrap(st, (a: number, b: number) => a + b, 'src/m.js', 'add')
    expect(f(1, 2)).toBe(3)
    expect(f(3, 4)).toBe(7)
    const obs = ofType(lines, 'OBSERVE_CALL')
    expect(obs.map((o) => o.sequence)).toEqual([0, 1])
    expect(obs[0]).toMatchObject({
      module: 'src/m.js',
      export: 'add',
      depth: 0,
      args: [1, 2],
      argsFingerprint: fingerprint(serializeArgs([1, 2])),
      callSiteId: callSiteIdOf(tid(st), 'src/m.js', 'add', 0, 0),
      mutated: false,
    })
    expect(ofType(lines, 'TARGET_RETURN')[1]).toMatchObject({ async: false, value: 7 })
    startTest(st, 'other')
    f(0, 0)
    expect(ofType(lines, 'OBSERVE_CALL')[2]?.sequence).toBe(0)
  })
  it('hors test : pas de call site ; au-delà de 20 appels les arguments sont omis', () => {
    const { st, lines } = state()
    const f = wrap(st, () => 0, 'm', 'f')
    for (let i = 0; i < 21; i++) f(i)
    const obs = ofType(lines, 'OBSERVE_CALL')
    expect(obs[0]?.callSiteId).toBeNull()
    expect(obs[19]?.args).toEqual([19])
    expect(obs[20]).toMatchObject({ argsOmitted: true })
    expect(obs[20]?.args).toBeUndefined()
  })
  it('redaction : champs, motifs et chemins `inputs.skip` masqués, secrets retirés des erreurs', () => {
    const { st, lines } = state(
      { VARIA_REDACT: '<dir>/r.json' },
      { 'r.json': { fields: ['password'], patterns: ['^api'], skipPaths: ['login#arg1'] } },
    )
    startTest(st)
    const login = wrap(
      st,
      (u: { password: string; apiKey: string }, pin: string) => {
        throw new Error(`bad ${u.password} ${pin}`)
      },
      'm',
      'login',
    )
    expect(() => login({ password: 'hunter2', apiKey: 'k-123' }, '9876')).toThrow('bad hunter2')
    const text = JSON.stringify(lines)
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('k-123')
    expect(text).not.toContain('9876')
    expect(ofType(lines, 'TARGET_THROW')[0]?.error?.message).toBe('bad [REDACTED] [REDACTED]')
  })
})

describe('profondeur (CDC §10.11, J0-16)', () => {
  it('appels transitifs : 0 puis 1, même avec des appels async ENTRELACÉS', async () => {
    const { st, lines } = state()
    startTest(st)
    const inner = wrap(st, (x: string) => x.length, 'src/text.js', 'inner')
    const outer = wrap(
      st,
      async (x: string, wait: number) => {
        await new Promise((r) => setTimeout(r, wait))
        return inner(x)
      },
      'src/chain.js',
      'outer',
    )
    // Le premier appel attend plus longtemps : les deux appels sont en vol en même temps et
    // `inner` est appelé pendant que l'autre `outer` est actif. Un compteur global donnerait 2.
    expect(await Promise.all([outer('aa', 20), outer('b', 1), inner('top')])).toEqual([2, 1, 3])
    const depths = ofType(lines, 'OBSERVE_CALL').map((o) => `${o.export}:${o.depth}`)
    expect(depths.sort()).toEqual(['inner:0', 'inner:1', 'inner:1', 'outer:0', 'outer:0'])
    const innerDeep = ofType(lines, 'OBSERVE_CALL').filter(
      (o) => o.export === 'inner' && o.depth === 1,
    )
    expect(innerDeep.map((o) => o.sequence).sort()).toEqual([0, 1])
  })
})

describe('mutation (CDC §10.1-10.4)', () => {
  function fuzz(m: Record<string, unknown>, args: unknown[]) {
    const s = state()
    startTest(s.st)
    const callSiteId = callSiteIdOf(tid(s.st), 'm', 'f', 0, 1)
    s.st.mutation = {
      id: 'm_x',
      callSiteId,
      argsFingerprint: fingerprint(serializeArgs(args)),
      path: ['0', 'name'],
      op: 'set' as const,
      value: null,
      ...m,
    } as State['mutation']
    const received: unknown[][] = []
    const f = wrap(s.st, (...a: unknown[]) => received.push(a), 'm', 'f')
    return { ...s, f, received }
  }
  it('seul le 2ᵉ appel est muté, sur une COPIE profonde ; l’objet d’origine est intact', () => {
    const user = { name: 'Erwann', nested: { tags: ['a'] } }
    const { f, received, lines } = fuzz({}, [user])
    f(user)
    f(user)
    f(user)
    expect(received[0]?.[0]).toBe(user)
    expect(received[2]?.[0]).toBe(user)
    const mutated = received[1]?.[0] as typeof user
    expect(mutated).not.toBe(user)
    expect(mutated.name).toBeNull()
    // Copie PROFONDE : un objet imbriqué n'est pas partagé avec l'original.
    expect(mutated.nested).not.toBe(user.nested)
    expect(mutated.nested).toEqual(user.nested)
    expect(user).toEqual({ name: 'Erwann', nested: { tags: ['a'] } })
    expect(ofType(lines, 'MUTATE_CALL')).toEqual([
      expect.objectContaining({ applied: true, mutationId: 'm_x', callId: 2 }),
    ])
    expect(ofType(lines, 'OBSERVE_CALL')[1]).toMatchObject({ mutated: true })
  })
  it('empreinte différente ⇒ AMBIGUOUS_CALL_SITE, jamais appliquée (J0-13)', () => {
    const { f, received, lines, st } = fuzz({ argsFingerprint: 'autre' }, [{ name: 'a' }])
    f({ name: 'a' })
    const arg = { name: 'a' }
    f(arg)
    expect(received[1]?.[0]).toBe(arg)
    expect(ofType(lines, 'MUTATE_CALL')).toEqual([
      expect.objectContaining({
        applied: false,
        reason: 'AMBIGUOUS_CALL_SITE',
        expectedFingerprint: 'autre',
        argsFingerprint: fingerprint(serializeArgs([arg], { hmacKey: st.hmacKey })),
      }),
    ])
  })
  it('chemin absent ⇒ PATH_NOT_FOUND ; suppression d’un champ ; clé __proto__ propre', () => {
    const a = fuzz({ path: ['0', 'x', 'y'] }, [{ name: 'a' }])
    a.f({ name: 'a' })
    a.f({ name: 'a' })
    expect(ofType(a.lines, 'MUTATE_CALL')[0]).toMatchObject({
      applied: false,
      reason: 'PATH_NOT_FOUND',
    })
    const b = fuzz({ op: 'delete' }, [{ name: 'a', age: 1 }])
    b.f({ name: 'a', age: 1 })
    b.f({ name: 'a', age: 1 })
    expect(b.received[1]?.[0]).toEqual({ age: 1 })
    const c = fuzz({ path: ['0', '__proto__'], value: { polluted: true } }, [{ name: 'a' }])
    c.f({ name: 'a' })
    c.f({ name: 'a' })
    const got = c.received[1]?.[0] as object
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(got, '__proto__')?.value).toEqual({ polluted: true })
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})

describe('issue de la cible (J0-14)', () => {
  it('levée synchrone, rejet et retour résolu sont distingués', async () => {
    const { st, lines } = state()
    startTest(st)
    const f = wrap(
      st,
      (x: number) => {
        if (x === 0) throw new TypeError('sync')
        return x < 0 ? Promise.reject(new RangeError('async')) : Promise.resolve(x)
      },
      'm',
      'f',
    )
    expect(() => f(0)).toThrow('sync')
    await expect(f(-1)).rejects.toThrow('async')
    await expect(f(5)).resolves.toBe(5)
    expect(ofType(lines, 'TARGET_THROW')[0]?.error).toMatchObject({
      name: 'TypeError',
      constructorChain: ['TypeError', 'Error'],
    })
    expect(ofType(lines, 'TARGET_REJECT')[0]?.error?.name).toBe('RangeError')
    expect(ofType(lines, 'TARGET_RETURN')[0]).toMatchObject({ async: true, value: 5 })
    expect(typeof ofType(lines, 'TARGET_RETURN')[0]?.durationMs).toBe('number')
  })
})

describe('sonde défensive (A-05)', () => {
  it('getter qui lève dans un argument : PROBE_ERROR, cible appelée avec les arguments d’origine', () => {
    const { st, lines } = state()
    startTest(st)
    const arg = {
      get boom(): number {
        throw new Error('getter hostile')
      },
    }
    let got: unknown
    const f = wrap(st, (a: unknown) => ((got = a), 'ok'), 'm', 'f')
    expect(f(arg)).toBe('ok')
    expect(got).toBe(arg)
    expect(ofType(lines, 'PROBE_ERROR')).toEqual([
      expect.objectContaining({
        reason: 'prepare',
        module: 'm',
        export: 'f',
        error: expect.objectContaining({ message: 'getter hostile' }),
      }),
    ])
    expect(ofType(lines, 'OBSERVE_CALL')).toEqual([])
  })
  it('Proxy qui lève sur `get` : même traitement ; `new` conservé', () => {
    const { st, lines } = state()
    const hostile = new Proxy(
      { a: 1 },
      {
        get() {
          throw new Error('proxy')
        },
      },
    )
    function Ctor(this: { v: unknown }, v: unknown) {
      this.v = v
    }
    const W = wrap(st, Ctor, 'm', 'Ctor')
    const inst = new (W as unknown as new (v: unknown) => { v: unknown })(hostile)
    expect(inst).toBeInstanceOf(Ctor)
    expect(inst.v).toBe(hostile)
    expect(ofType(lines, 'PROBE_ERROR')[0]?.reason).toBe('prepare')
  })
  it('journal impossible à écrire : marqueur sur stderr, la cible est quand même appelée', () => {
    const { st } = state()
    const err: string[] = []
    st.write = () => {
      throw new Error('ENOSPC')
    }
    st.stderr = (s: string) => err.push(s)
    const f = wrap(st, (x: number) => x * 2, 'm', 'f')
    expect(f(21)).toBe(42)
    expect(err).toEqual([`${P.STDERR_MARKER} prepare\n`])
    st.stderr = () => {
      throw new Error('stderr fermé')
    }
    expect(f(1)).toBe(2)
  })
  it('valeur de retour hostile : PROBE_ERROR (outcome), le retour est rendu tel quel', async () => {
    const { st, lines } = state()
    const bad = {
      get x(): number {
        throw new Error('retour hostile')
      },
    }
    const f = wrap(st, () => bad, 'm', 'f')
    expect(f()).toBe(bad)
    const g2 = wrap(st, async () => bad, 'm', 'g')
    expect(await g2()).toBe(bad)
    expect(ofType(lines, 'PROBE_ERROR').map((l) => l.reason)).toEqual(['outcome', 'outcome'])
    expect(ofType(lines, 'TARGET_RETURN')).toEqual([])
  })
  it('résultat dont `then` lève : rendu tel quel, traité comme un retour synchrone', () => {
    const { st, lines } = state()
    const weird = new Proxy(
      {},
      {
        get(_t, k) {
          if (k === 'then') throw new Error('then hostile')
          return undefined
        },
      },
    )
    const f = wrap(st, () => weird, 'm', 'f')
    expect(f()).toBe(weird)
    expect(ofType(lines, 'TARGET_RETURN')).toHaveLength(1)
  })
})

describe('serializeError (D.0)', () => {
  it('valeurs non objets, code et statut, pile filtrée, secrets retirés', () => {
    expect(P.serializeError('x secret', ['secret'])).toEqual({
      name: 'string',
      message: 'x [REDACTED]',
      stack: '',
      constructorChain: [],
    })
    expect(P.serializeError(null, []).name).toBe('object')
    const e = Object.assign(new RangeError('m'), { code: 'E1', status: '404' })
    e.stack = `RangeError: m\n    at f (/p/src/a.js:1:1)\n    at x (node:internal/y:1:1)\n    at z (${join(__dirname, '..', 'runtime', 'probe.cjs')}:1:1)\n    at c (/n/jest-circus/x.js:1:1)`
    const s = P.serializeError(e, [])
    expect(s).toMatchObject({
      name: 'RangeError',
      code: 'E1',
      status: 404,
      constructorChain: ['RangeError', 'Error'],
    })
    expect(s.stack).toBe('    at f (/p/src/a.js:1:1)')
    const plain = P.serializeError({ name: 'N', message: 'M' }, [])
    expect(plain).toEqual({ name: 'N', message: 'M', stack: '', constructorChain: [] })
  })
  it('erreur hostile : jamais d’exception', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('x')
        },
        getPrototypeOf() {
          throw new Error('y')
        },
      },
    )
    expect(P.serializeError(hostile, [])).toEqual({
      name: '',
      message: '',
      stack: '',
      constructorChain: [],
    })
    const unprintable = {
      toString: () => {
        throw new Error('z')
      },
    }
    expect(P.serializeError({ name: unprintable, message: 'm' }, []).name).toBe('')
    const sym = Symbol('s')
    expect(P.serializeError(sym, []).message).toBe('Symbol(s)')
  })
})

describe('copie profonde et mutation', () => {
  it('copie les types usuels, conserve prototypes, cycles et accesseurs sans les appeler', () => {
    class Point {
      constructor(public x: number) {}
    }
    let calls = 0
    const src: Record<string, unknown> = {
      d: new Date(5),
      r: /a/g,
      b: Buffer.from('hi'),
      m: new Map([[1, { a: 1 }]]),
      s: new Set([{ b: 2 }]),
      p: new Point(1),
      arr: [1, [2]],
    }
    Object.defineProperty(src, 'acc', { get: () => ++calls, enumerable: true })
    src.self = src
    const c = P.deepClone(src) as {
      d: Date
      r: RegExp
      b: Buffer
      m: Map<number, unknown>
      s: Set<unknown>
      p: unknown
      arr: unknown
      self: unknown
    }
    expect(calls).toBe(0)
    expect(c.d).toEqual(new Date(5))
    expect(c.d).not.toBe(src.d)
    expect(c.r).toEqual(/a/g)
    expect(c.b.toString()).toBe('hi')
    expect(c.m.get(1)).toEqual({ a: 1 })
    expect(c.m.get(1)).not.toBe((src.m as Map<number, unknown>).get(1))
    expect([...c.s][0]).toEqual({ b: 2 })
    expect(c.p).toBeInstanceOf(Point)
    expect(c.arr).toEqual([1, [2]])
    expect(c.self).toBe(c)
    expect(P.deepClone(3)).toBe(3)
  })
  it('chemin traversant une valeur non objet ⇒ null', () => {
    expect(
      P.applyMutation([{ a: 1 }], {
        id: 'm',
        callSiteId: 'c',
        argsFingerprint: 'f',
        path: ['0', 'a', 'b'],
        op: 'set',
        value: 1,
      }),
    ).toBeNull()
  })
})

describe('enveloppement des exports', () => {
  it('module CommonJS : fonctions enveloppées, classes et non modifiables non supportées, getters', () => {
    const { st, lines } = state()
    class K {
      readonly k = 1
    }
    const fn = () => 1
    const exp: Record<string, unknown> = {
      fn,
      K,
      n: 1,
      already: wrap(st, () => 2, 'm', 'already'),
    }
    Object.defineProperty(exp, 'frozen', {
      value: () => 3,
      enumerable: true,
      writable: false,
      configurable: false,
    })
    let current = () => 4
    Object.defineProperty(exp, 'lazy', { get: () => current, enumerable: true, configurable: true })
    Object.defineProperty(exp, 'lazyClass', { get: () => K, enumerable: true, configurable: true })
    const out = P.wrapExports(exp, 'src/m.js') as Record<string, () => unknown>
    expect(out).toBe(exp)
    expect(out['fn']).not.toBe(fn)
    expect(must(out['fn'])()).toBe(1)
    expect(out['K']).toBe(K)
    expect(out['lazy']).toBe(out['lazy'])
    expect(must(out['lazy'])()).toBe(4)
    current = () => 5
    expect(must(out['lazy'])()).toBe(5)
    expect(out['lazyClass']).toBe(K)
    const discover = ofType(lines, 'DISCOVER')
    expect(discover).toEqual([
      {
        ...discover[0],
        module: 'src/m.js',
        wrapped: ['fn', 'lazy', 'lazyClass'],
        unsupported: ['K', 'frozen'],
      },
    ])
    P.wrapExports({}, 'src/m.js')
    expect(ofType(lines, 'DISCOVER')).toHaveLength(1)
  })
  it('export par défaut fonction ou classe ; valeurs non objet ; échec d’un export isolé', () => {
    const { st, lines } = state()
    const def = Object.assign(() => 'd', { helper: () => 'h' })
    const out = P.wrapExports(def, 'a') as typeof def
    expect(out).not.toBe(def)
    expect(out()).toBe('d')
    expect(out.helper()).toBe('h')
    class C {
      readonly c = 1
    }
    expect(P.wrapExports(C, 'b')).toBe(C)
    expect(P.wrapExports(null, 'c')).toBeNull()
    expect(P.wrapExports(7, 'd')).toBe(7)
    const hostile = new Proxy(
      { x: () => 1 },
      {
        defineProperty() {
          throw new Error('écriture hostile')
        },
      },
    )
    expect(P.wrapExports(hostile, 'e')).toBe(hostile)
    const unlistable = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('liste hostile')
        },
      },
    )
    expect(P.wrapExports(unlistable, 'f')).toBe(unlistable)
    expect(ofType(lines, 'PROBE_ERROR').map((l) => [l.reason, l.module, l.export])).toEqual([
      ['wrap', 'e', 'x'],
      ['wrap', 'f', '*'],
    ])
    expect(ofType(lines, 'DISCOVER').map((d) => [d.module, d.wrapped, d.unsupported])).toEqual([
      ['a', ['default', 'helper'], []],
      ['b', [], ['default']],
      ['c', [], []],
      ['d', [], []],
      ['e', [], []],
      ['f', [], []],
    ])
    expect(st.announced.size).toBe(6)
  })
  it('wrapExport (ESM réécrit) : non-fonctions et déjà enveloppées intactes, classes signalées', () => {
    const { lines } = state()
    expect(P.wrapExport(1, 'm', 'x')).toBe(1)
    const f = P.wrapExport(() => 1, 'm', 'f')
    expect(P.wrapExport(f, 'm', 'f')).toBe(f)
    class C {
      readonly c = 1
    }
    expect(P.wrapExport(C, 'm', 'C')).toBe(C)
    expect(ofType(lines, 'DISCOVER').map((d) => [d.wrapped, d.unsupported])).toEqual([
      [['f'], []],
      [[], ['C']],
    ])
  })
})

describe('branchement sur le runner', () => {
  it('install : HELLO, identité de test (homonymes), TEST_START / TEST_END', () => {
    const { st, lines } = state()
    let before: () => void = () => undefined
    let after: () => void = () => undefined
    let current = { testPath: join(st.projectRoot, 'tests', 'a.test.js'), currentTestName: 's > t' }
    probe.install({
      beforeEach: (f: () => void) => (before = f),
      afterEach: (f: () => void) => (after = f),
      getState: () => current,
      nameOf: (s: { currentTestName?: string }) => String(s.currentTestName).split(' > ').join(' '),
    })
    before()
    expect(st.currentTest).toEqual({
      testId: testIdOf('tests/a.test.js', 's t', 0),
      file: 'tests/a.test.js',
      name: 's t',
    })
    after()
    expect(st.currentTest).toBeNull()
    before()
    expect(tid(st)).toBe(testIdOf('tests/a.test.js', 's t', 1))
    current = {} as never
    probe.install({
      beforeEach: (f: () => void) => (before = f),
      afterEach: () => undefined,
      getState: () => current,
    })
    before()
    expect(st.currentTest).toMatchObject({ name: '', file: expect.any(String) })
    expect(lines.map((l) => l.type)).toEqual([
      'HELLO',
      'TEST_START',
      'TEST_END',
      'TEST_START',
      'HELLO',
      'TEST_START',
    ])
    expect(lines[0]).toMatchObject({ mode: 'observe', pid: process.pid, mutationId: null })
  })
  it('install sans état : rien', () => {
    g.__varia = null
    expect(probe.install({} as never)).toBeUndefined()
  })
  it('boot : état conservé (resetModules) et branchement automatique sous Jest seulement', () => {
    const dir = mkdtempSync(join(tmpdir(), 'varia-probe-'))
    const env = { VARIA_MODE: 'observe', VARIA_RUN_DIR: dir }
    const hooks: string[] = []
    let registered: () => void = () => undefined
    const jestLike: FakeGlobal = {
      beforeEach: (f: () => void) => {
        registered = f
        hooks.push('before')
      },
      afterEach: () => hooks.push('after'),
      expect: { getState: () => ({}) },
    }
    P.boot(jestLike, env)
    expect(jestLike.__varia?.mode).toBe('observe')
    expect(hooks).toEqual(['before', 'after'])
    // Le crochet branché lit l'état du test par `expect.getState()` de Jest.
    registered()
    expect(jestLike.__varia?.currentTest).toMatchObject({ name: '' })
    const kept = jestLike.__varia
    P.boot(jestLike, {})
    expect(jestLike.__varia).toBe(kept)
    const bare: FakeGlobal = {}
    P.boot(bare, env)
    expect(bare.__varia?.mode).toBe('observe')
    const noExpect: FakeGlobal = { beforeEach: () => hooks.push('x') }
    P.boot(noExpect, env)
    const outside: FakeGlobal = {
      beforeEach: () => hooks.push('y'),
      expect: { getState: () => ({}) },
    }
    P.boot(outside, {})
    expect(outside.__varia).toBeNull()
    // Chaque fichier de test réévalue la sonde : branchement à nouveau, état conservé.
    expect(hooks).toEqual(['before', 'after', 'before', 'after'])
  })
})

describe('rejets non gérés (A-02)', () => {
  const fakeProcess = () => Object.assign(new EventEmitter(), {}) as unknown as NodeJS.Process

  it('sans processus réel atteignable : pas d’écoute', () => {
    const { st } = state()
    expect(P.installRejectionHook(st, null)).toBe(false)
    expect(P.publishedProcess()).toBe(
      (asyncHooks as Record<symbol, unknown>)[P.REAL_PROCESS] ?? null,
    )
  })
  it('promesse créée pendant un appel : étiquetée et attribuée à l’appel (contexte asynchrone)', async () => {
    const { st, lines } = state()
    startTest(st)
    const proc = fakeProcess()
    expect(P.installRejectionHook(st, proc)).toBe(true)
    // Second fichier de test : l'écouteur est partagé, l'état courant remplacé.
    expect(P.installRejectionHook(st, proc)).toBe(true)
    expect(proc.listenerCount('unhandledRejection')).toBe(1)
    let leaked: Promise<unknown> | null = null
    const outer = wrap(
      st,
      () => {
        leaked = Promise.resolve().then(() => {
          throw new TypeError('cannot read email')
        })
        return true
      },
      'src/notify.js',
      'scheduleWelcome',
    )
    expect(outer({ email: null })).toBe(true)
    const p = leaked as unknown as Promise<unknown>
    p.catch(() => undefined)
    expect(proc.listeners('unhandledRejection')).toHaveLength(1)
    proc.on('unhandledRejection', () => undefined)
    proc.emit('unhandledRejection', new TypeError('cannot read email'), p)
    const ur = ofType(lines, 'UNHANDLED_REJECTION')
    expect(ur).toEqual([
      expect.objectContaining({
        callId: 1,
        callSiteId: callSiteIdOf(tid(st), 'src/notify.js', 'scheduleWelcome', 0, 0),
        chain: [1],
        error: expect.objectContaining({ name: 'TypeError' }),
      }),
    ])
  })
  it('promesse rendue par la cible et non attendue ; rejet hors appel ; seul écouteur ⇒ comportement de Node', async () => {
    const { st, lines } = state()
    const proc = fakeProcess()
    P.installRejectionHook(st, proc)
    const f = wrap(st, () => Promise.reject(new RangeError('r')), 'm', 'f')
    const p = f() as Promise<unknown>
    p.catch(() => undefined)
    await Promise.resolve()
    expect(() => proc.emit('unhandledRejection', new RangeError('r'), p)).toThrow('r')
    proc.on('unhandledRejection', () => undefined)
    proc.emit('unhandledRejection', 'brut', Promise.resolve())
    proc.emit('unhandledRejection', 'sans promesse', undefined as never)
    const ur = ofType(lines, 'UNHANDLED_REJECTION')
    expect(ur.map((u) => u.callId)).toEqual([1, undefined, undefined])
    expect(ur[1]).toMatchObject({
      chain: [],
      callSiteId: null,
      error: { name: 'string', message: 'brut' },
    })
  })
  it('écriture impossible pendant un rejet : PROBE_ERROR sur stderr', () => {
    const { st } = state()
    const err: string[] = []
    st.write = () => {
      throw new Error('ENOSPC')
    }
    st.stderr = (s: string) => err.push(s)
    P.onUnhandledRejection(st, new Error('x'), null)
    expect(err).toEqual([`${P.STDERR_MARKER} unhandled-rejection\n`])
  })
  it('sous Jest : processus réel publié par le transform, écoute installée à l’enveloppement', () => {
    const { st } = state()
    const proc = fakeProcess()
    Object.defineProperty(asyncHooks, P.REAL_PROCESS, { value: proc, configurable: true })
    try {
      P.wrapExports({ f: () => 1 }, 'x')
      expect(proc.listenerCount('unhandledRejection')).toBe(1)
      probe.install({
        beforeEach: () => undefined,
        afterEach: () => undefined,
        getState: () => ({}),
        process: proc,
      })
      expect(proc.listenerCount('unhandledRejection')).toBe(1)
    } finally {
      Reflect.deleteProperty(asyncHooks, P.REAL_PROCESS)
    }
    expect(st.mode).toBe('observe')
  })
})
