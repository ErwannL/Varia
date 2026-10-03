// API publique de @varia/testkit (J4 T-01) : fabriques, doubles de sonde, harnais, assertions,
// outils d'extension — chaque fonction vérifiée contre le comportement de Varia.
import { buildCatalog, classify, observationOf } from '@varia/core'
import {
  adapterRun,
  applyMutation,
  assertDeterministic,
  assertStatus,
  callSite,
  checkDeterminism,
  DEFAULT_LIMITS,
  inputAt,
  inputsOf,
  mutationOf,
  planFor,
  probe,
  probeEvent,
  renderWith,
  runMutation,
  serializedError,
} from '@varia/testkit'
import { AssertionError } from 'node:assert'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FIX = join(import.meta.dirname, '..', '..', 'plugins', 'test', 'fixtures')

describe('fabriques', () => {
  it('callSite : identité, redaction et empreinte comme la sonde', () => {
    const c = callSite({ args: [{ email: 'a@b.c', password: 'x' }] })
    expect(c.callSiteId).toMatch(/^c_[0-9a-f]{16}$/)
    expect(c.argsFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(c.args)).not.toContain('"x"')
    const d = callSite({
      args: [{ secret: 's', other: 'o' }],
      redact: ['other'],
      module: 'm.js',
      export: 'e',
      testFile: 't.js',
      testName: 'n',
      depth: 1,
      sequence: 2,
      outcome: { kind: 'throw', async: false },
    })
    expect([d.module, d.export, d.depth, d.sequence, d.callId, d.outcome.kind]).toEqual([
      'm.js',
      'e',
      1,
      2,
      3,
      'throw',
    ])
    expect(JSON.stringify(d.args)).toContain('"s"')
    expect(JSON.stringify(d.args)).not.toContain('"o"')
  })

  it('inputsOf / inputAt : catalogue du cœur ; chemin absent ⇒ erreur', () => {
    const c = callSite({ args: [{ email: 'a@b.c', password: 'x' }, 3] })
    expect(inputsOf(c)).toEqual(buildCatalog([c]))
    expect(inputsOf([c, c])).toHaveLength(2 * inputsOf(c).length)
    expect(inputAt(c, 'arg0.email').format).toBe('email')
    expect(inputAt(c, 'arg0.password').mutable).toBe(false)
    expect(() => inputAt(c, 'arg9')).toThrow('entrée absente : arg9')
  })

  it('mutationOf / planFor : identifiants et plan du cœur', () => {
    const c = callSite({ args: [{ n: 1 }] })
    const i = inputAt(c, 'arg0.n')
    const m = mutationOf(i, { strategy: 'null', value: null })
    expect([m.op, m.mutatedType, m.originalType, m.testFile]).toEqual([
      'set',
      'null',
      'number',
      'tests/demo.test.js',
    ])
    const del = mutationOf(
      i,
      { strategy: 'x', op: 'delete', value: null },
      { file: 'f', name: 'n' },
    )
    expect([del.mutatedType, del.testFile, del.testName]).toEqual(['undefined', 'f', 'n'])
    const plan = planFor([c], { strategies: ['null'], seed: 3, perInput: 5 })
    expect(plan.seed).toBe(3)
    expect(plan.mutations.map((x) => x.strategy)).toEqual(['null', 'null'])
    const extra = new Map([
      [`${c.callSiteId}|arg0.n`, [{ strategy: 'p/s', op: 'set' as const, value: 9 }]],
    ])
    expect(planFor([c], { extra }).mutations.map((x) => x.value)).toEqual([9])
    expect(planFor([c]).mutations).toEqual([])
  })
})

describe('doubles de sonde', () => {
  it('messages du protocole reconstitués par le cœur comme ceux d’une vraie sonde', () => {
    const c = callSite({ args: [1] })
    const err = serializedError(new TypeError('t'))
    const events = [
      probe.hello(),
      probe.observeCall(c),
      probe.mutateCall(c, 'm_1'),
      probe.mutateCall(c, 'm_2', false, 'AMBIGUOUS'),
      probe.targetThrow(c, err),
    ]
    const o = observationOf(adapterRun({ events }))
    expect(o.helloCount).toBe(1)
    expect(o.calls[0]?.outcome).toEqual({ kind: 'throw', async: false, error: err })
    expect(o.mutateEvents.map((e) => [e.applied, e.reason])).toEqual([
      [true, undefined],
      [false, 'AMBIGUOUS'],
    ])
    const ret = observationOf(
      adapterRun({ events: [probe.observeCall(c), probe.targetReturn(c, 2, true)] }),
    )
    expect(ret.calls[0]?.outcome).toEqual({ kind: 'return', async: true, value: 2 })
    const rej = observationOf(
      adapterRun({ events: [probe.observeCall(c), probe.targetReject(c, err)] }),
    )
    expect(rej.calls[0]?.outcome.kind).toBe('reject')
    const noArgs = probe.observeCall({ ...c, args: null })
    expect('args' in noArgs).toBe(false)
    expect(probeEvent('TEST_END', { testId: 't' })).toMatchObject({ type: 'TEST_END', testId: 't' })
  })

  it('serializedError : chaîne des constructeurs, code et statut', () => {
    class HttpError extends Error {
      code = 'E_HTTP'
      status = 404
    }
    const e = serializedError(new HttpError('absent'))
    expect(e).toMatchObject({ name: 'Error', code: 'E_HTTP', status: 404 })
    expect(e.constructorChain).toEqual(['HttpError', 'Error'])
    const plain = new Error('m')
    delete plain.stack
    expect(serializedError(plain)).toEqual({
      name: 'Error',
      message: 'm',
      stack: '',
      constructorChain: ['Error'],
    })
  })

  it('adapterRun : processus scripté (crash, délai, rapport absent)', () => {
    const r = adapterRun({
      events: [],
      tests: null,
      exitCode: null,
      signal: 'SIGKILL',
      timedOut: true,
      stderr: 'x',
    })
    expect(r.process).toMatchObject({
      exitCode: null,
      signal: 'SIGKILL',
      timedOut: true,
      stderr: 'x',
    })
    expect(r.tests).toBeNull()
    const c = classify({
      mutation: mutationOf(inputAt(callSite({ args: [1] }), 'arg0'), {
        strategy: 'null',
        value: null,
      }),
      process: r.process,
      hello: true,
      reportPresent: false,
      testStatus: null,
      mutateEvents: [],
      mutatedCall: undefined,
    })
    assertStatus(c, 'TIMEOUT')
  })
})

describe('harnais d’exécution d’une mutation', () => {
  const c = callSite({
    args: [{ user: { name: 'a' }, list: [1, 2], $t: 'piège' }, 5],
  })
  const run = (path: string, value: unknown, target: (...a: never[]) => unknown, op?: 'delete') =>
    runMutation({
      target,
      call: c,
      mutation: mutationOf(inputAt(c, path), {
        strategy: 's',
        value: value as never,
        ...(op ? { op } : {}),
      }),
    })

  it('applyMutation : objets simples, étiquetés, tableaux, suppression, argument entier', () => {
    const args = c.args ?? []
    const set = applyMutation(args, { path: ['0', 'user', 'name'], op: 'set', value: 1 })
    expect(JSON.stringify(set)).toContain('"name":1')
    expect(JSON.stringify(args)).toContain('"name":"a"')
    const hole = applyMutation(args, { path: ['0', 'list', '1'], op: 'delete', value: null })
    expect(JSON.stringify(hole)).toContain('{"$t":"hole"}')
    const del = applyMutation(args, { path: ['0', 'user', 'name'], op: 'delete', value: null })
    expect(JSON.stringify(del)).not.toContain('name')
    expect(applyMutation(args, { path: ['1'], op: 'delete', value: null })[1]).toEqual({
      $t: 'undefined',
    })
    expect(applyMutation(args, { path: ['1'], op: 'set', value: 7 })[1]).toBe(7)
  })

  it('cible synchrone, asynchrone, qui lève une non-Error ; oracle personnalisé', async () => {
    const ok = await run('arg1', 6, ((_o: unknown, n: number) => n * 2) as never)
    assertStatus(ok.classification, 'PASSED')
    expect(ok.events.map((e) => e.type)).toEqual([
      'HELLO',
      'OBSERVE_CALL',
      'MUTATE_CALL',
      'TARGET_RETURN',
    ])
    const rejected = await run('arg0.user.name', null, (async () => {
      throw new TypeError('boom')
    }) as never)
    assertStatus(rejected.classification, 'CRASH')
    const odd = await run('arg1', null, (() => {
      throw 'texte'
    }) as never)
    assertStatus(odd.classification, 'UNEXPECTED_FAILURE')
    expect(odd.classification.error?.message).toBe('texte')
    const custom = await runMutation({
      target: (() => {
        throw new RangeError('r')
      }) as never,
      call: c,
      mutation: mutationOf(inputAt(c, 'arg1'), { strategy: 's', value: 0 }),
      oracle: { handledErrors: ['RangeError'], crashErrors: [] },
    })
    assertStatus(custom.classification, 'HANDLED')
    // Arguments omis par la sonde (`args: null`) : la mutation d'un argument entier reste possible.
    const omitted = await runMutation({
      target: ((_a: unknown, n: unknown) => n) as never,
      call: { ...c, args: null },
      mutation: mutationOf(inputAt(c, 'arg1'), { strategy: 's', value: 4 }),
    })
    assertStatus(omitted.classification, 'PASSED')
    expect(omitted.events[3]?.value).toBe(4)
  })

  it('règles d’extensions appliquées ; résultat hors comportement de la cible : règle non appelée', async () => {
    const r = await runMutation({
      target: (() => {
        throw Object.assign(new Error('v'), { code: 'E_VALIDATION' })
      }) as never,
      call: c,
      mutation: mutationOf(inputAt(c, 'arg1'), { strategy: 's', value: 0 }),
      plugins: ['./complet.mjs'],
      baseDir: FIX,
      timeoutMs: 10_000,
    })
    assertStatus(r.classification, 'HANDLED', {
      reason: 'RULE:complet/code-validation:CODE_E_VALIDATION',
    })
    expect(r.pluginFailures).toEqual([])
    const skipped = await run('arg1', 0, (() => 1) as never, 'delete')
    assertStatus(skipped.classification, 'PASSED')
  })
})

describe('assertions et extensions', () => {
  it('assertStatus : statut, sous-type, raison ; échec ⇒ AssertionError explicite', () => {
    const c = {
      status: 'PASSED' as const,
      subtype: 'SUSPICIOUS_ACCEPT' as const,
      reason: 'ECHO',
      testStatus: null,
    }
    assertStatus(c, 'PASSED', { subtype: 'SUSPICIOUS_ACCEPT', reason: 'ECHO' })
    expect(() => assertStatus(c, 'CRASH')).toThrow(AssertionError)
    expect(() =>
      assertStatus({ status: 'PASSED', testStatus: null }, 'PASSED', { subtype: 'X' }),
    ).toThrow(
      'statut attendu {"status":"PASSED","subtype":"X"}, obtenu {"status":"PASSED","subtype":null}',
    )
    expect(() =>
      assertStatus({ status: 'PASSED', testStatus: null }, 'PASSED', { reason: null }),
    ).not.toThrow()
  })

  it('checkDeterminism / assertDeterministic : stratégie non déterministe détectée', () => {
    const i = inputsOf(callSite({ args: [1] }))
    const bad = {
      plugin: './fautif.mjs',
      baseDir: FIX,
      strategy: 'fautif/non-deterministe',
      inputs: i,
    }
    const r = checkDeterminism(bad)
    expect(r.deterministic).toBe(false)
    expect(r.failures.map((f) => f.code)).toEqual(['NON_DETERMINISTIC', 'NON_DETERMINISTIC'])
    expect(() => assertDeterministic(bad)).toThrow(
      /non déterministe ou en erreur : fautif\/non-deterministe/,
    )
    const good = assertDeterministic({
      plugin: './complet.mjs',
      baseDir: FIX,
      strategy: 'complet/tirage',
      inputs: i,
      limits: DEFAULT_LIMITS,
    })
    expect(good.size).toBe(1)
    // Sans `baseDir` : chemin absolu (ou paquet résolu depuis le dossier courant).
    const r2 = renderWith({ plugin: join(FIX, 'complet.mjs'), report: { mutations: [] } })
    expect(r2.outputs.map((o) => o.content)).toEqual(['mutations=0\n'])
  })
})
