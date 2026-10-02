import type { Json } from '@varia/probe-protocol'
import type { Hint } from '../src/hints.js'
import { describe, expect, it } from 'vitest'
import type { ObservedCall } from '../src/observe.js'
import { classify, DEFAULT_ORACLE, findEcho, type OracleInput } from '../src/oracle.js'
import type { PlannedMutation } from '../src/plan.js'
import type { ProcessResult } from '../src/exec/proc.js'

const proc = (over: Partial<ProcessResult> = {}): ProcessResult => ({
  exitCode: 1,
  signal: null,
  timedOut: false,
  durationMs: 1,
  stdout: '',
  stderr: '',
  outputTruncated: false,
  pid: 1,
  ...over,
})
const mutation = (over: Partial<PlannedMutation> = {}): PlannedMutation =>
  ({
    id: 'm',
    callSiteId: 'c',
    strategy: 'type',
    op: 'set',
    value: {},
    originalType: 'string',
    mutatedType: 'object',
    ...over,
  }) as PlannedMutation
const call = (outcome: ObservedCall['outcome']) =>
  ({ outcome, mutated: true, callSiteId: 'c' }) as ObservedCall
const err = (name: string, chain: string[], stack = '    at f (/p/src/a.js:1:1)') => ({
  name,
  message: 'x',
  stack,
  constructorChain: chain,
})
const input = (over: Partial<OracleInput> = {}): OracleInput => ({
  mutation: mutation(),
  process: proc(),
  hello: true,
  reportPresent: true,
  testStatus: 'failed',
  mutateEvents: [{ type: 'MUTATE_CALL', applied: true } as OracleInput['mutateEvents'][number]],
  mutatedCall: call({
    kind: 'throw',
    async: false,
    error: err('TypeError', ['TypeError', 'Error']),
  }),
  ...over,
})

describe('ordre d’évaluation (CDC §18.3)', () => {
  it('1 infrastructure', () => expect(classify(input({ hello: false })).status).toBe('INFRA_ERROR'))
  it('2 timeout prime sur tout', () =>
    expect(classify(input({ hello: false, process: proc({ timedOut: true }) })).status).toBe(
      'TIMEOUT',
    ))
  it('3 sortie anormale', () =>
    expect(classify(input({ reportPresent: false })).subtype).toBe('PROCESS_EXIT'))
  it('3 signal', () =>
    expect(classify(input({ process: proc({ signal: 'SIGSEGV' }) })).status).toBe('CRASH'))
  it('4 mutation non appliquée', () => {
    const r = classify(
      input({
        mutateEvents: [
          {
            type: 'MUTATE_CALL',
            applied: false,
            reason: 'AMBIGUOUS_CALL_SITE',
          } as OracleInput['mutateEvents'][number],
        ],
      }),
    )
    expect([r.status, r.reason]).toEqual(['SKIPPED', 'AMBIGUOUS_CALL_SITE'])
  })
  it('4 mutation jamais atteinte', () =>
    expect(classify(input({ mutateEvents: [] })).reason).toBe('NOT_REACHED'))
})

describe('erreurs de la cible', () => {
  it('TypeError ⇒ CRASH', () => expect(classify(input()).status).toBe('CRASH'))
  it('ValidationError par chaîne de constructeurs ⇒ HANDLED', () => {
    const r = classify(
      input({
        mutatedCall: call({
          kind: 'reject',
          async: true,
          error: err('Error', ['ValidationError', 'Error']),
        }),
      }),
    )
    expect([r.status, r.outcome]).toEqual(['HANDLED', 'reject'])
  })
  it('erreur inconnue ⇒ UNEXPECTED_FAILURE', () => {
    expect(
      classify(
        input({
          mutatedCall: call({ kind: 'throw', async: false, error: err('Error', ['Error']) }),
        }),
      ).status,
    ).toBe('UNEXPECTED_FAILURE')
  })
  it('origine node_modules ⇒ DEPENDENCY_ERROR', () => {
    const e = err('TypeError', ['TypeError'], '    at g (/p/node_modules/lib/x.js:1:1)')
    expect(
      classify(input({ mutatedCall: call({ kind: 'throw', async: false, error: e }) })).subtype,
    ).toBe('DEPENDENCY_ERROR')
  })
  it('J0-6 : le statut du test ne change pas la classification', () => {
    expect(classify(input({ testStatus: 'passed' })).status).toBe(
      classify(input({ testStatus: 'failed' })).status,
    )
  })
  it('sans issue observée', () =>
    expect(classify(input({ mutatedCall: call({ kind: 'none', async: false }) })).reason).toBe(
      'TARGET_NO_OUTCOME',
    ))
})

describe('ECHO (CDC §18.4)', () => {
  const ret = (value: unknown) => call({ kind: 'return', async: false, value: value as never })
  it('positif : valeur de type changé renvoyée telle quelle', () => {
    const r = classify(input({ mutatedCall: ret({ received: {} }) }))
    expect([r.subtype, r.reason, r.echoPath]).toEqual([
      'SUSPICIOUS_ACCEPT',
      'ECHO',
      'return.received',
    ])
  })
  it('négatif : primitif banal', () => {
    expect(
      classify(
        input({
          mutation: mutation({ value: 0, mutatedType: 'number' }),
          mutatedCall: ret({ received: 0 }),
        }),
      ).subtype,
    ).toBeUndefined()
  })
  it('négatif : stratégie hors type/structure', () => {
    expect(
      classify(
        input({ mutation: mutation({ strategy: 'empty' }), mutatedCall: ret({ received: {} }) }),
      ).subtype,
    ).toBeUndefined()
  })
  it('négatif : type inchangé', () => {
    expect(
      classify(
        input({
          mutation: mutation({ originalType: 'object' }),
          mutatedCall: ret({ received: {} }),
        }),
      ).subtype,
    ).toBeUndefined()
  })
  it('négatif : valeur non renvoyée', () => {
    expect(classify(input({ mutatedCall: ret({ received: 'x' }) })).status).toBe('PASSED')
    expect(classify(input({ mutatedCall: ret({ received: 'x' }) })).subtype).toBeUndefined()
  })
  it('findEcho dans les tableaux et objets étiquetés', () => {
    expect(findEcho([1, { a: [123] }], 123)).toBe('return[1].a[0]')
    expect(findEcho({ $t: 'object', ctor: 'U', v: { k: 'v' } }, 'v')).toBe('return.k')
    expect(findEcho({ $t: 'map', entries: [] }, 1)).toBeNull()
  })
})

describe('règles de configuration', () => {
  const thrown = (e: ReturnType<typeof err> & { code?: string; status?: number }) =>
    input({ mutatedCall: call({ kind: 'throw', async: false, error: e }) })
  it('handled_errors par code, statut, motif de nom, message', async () => {
    const { DEFAULT_ORACLE } = await import('../src/oracle.js')
    const cfg = (rule: object) => ({ ...DEFAULT_ORACLE, handledRules: [rule] })
    expect(
      classify(thrown({ ...err('Error', ['Error']), code: 'ERR_X' }), cfg({ code: 'ERR_X' }))
        .status,
    ).toBe('HANDLED')
    expect(
      classify(thrown({ ...err('HttpError', ['HttpError']), status: 400 }), cfg({ status: 400 }))
        .status,
    ).toBe('HANDLED')
    expect(
      classify(thrown(err('BadInputError', ['BadInputError'])), cfg({ namePattern: '^Bad' }))
        .status,
    ).toBe('HANDLED')
    expect(classify(thrown(err('Error', ['Error'])), cfg({ message: '^x$' })).status).toBe(
      'HANDLED',
    )
    expect(classify(thrown(err('Error', ['Error'])), cfg({ message: '^y$' })).status).toBe(
      'UNEXPECTED_FAILURE',
    )
    expect(classify(thrown(err('Error', ['Error'])), cfg({})).status).toBe('UNEXPECTED_FAILURE')
  })
  it('HINT_VIOLATION : contrat déclaré violé et retour normal', () => {
    const ret = call({ kind: 'return', async: false, value: { ok: true } })
    const hint = { path: 'f#arg0.age', range: [0, 150] as [number, number] }
    const r = classify(
      input({
        mutation: mutation({
          strategy: 'boundary',
          value: 151,
          mutatedType: 'number',
          originalType: 'number',
        }),
        mutatedCall: ret,
        hint,
      }),
    )
    expect([r.subtype, r.reason]).toEqual(['SUSPICIOUS_ACCEPT', 'HINT_VIOLATION'])
    const ok = classify(
      input({
        mutation: mutation({
          strategy: 'boundary',
          value: 150,
          mutatedType: 'number',
          originalType: 'number',
        }),
        mutatedCall: ret,
        hint,
      }),
    )
    expect(ok.subtype).toBeUndefined()
  })
  it('suspicious_accept: ignore', async () => {
    const { DEFAULT_ORACLE } = await import('../src/oracle.js')
    const r = classify(
      input({ mutatedCall: call({ kind: 'return', async: false, value: { received: {} } }) }),
      { ...DEFAULT_ORACLE, suspiciousAccept: 'ignore' },
    )
    expect(r.subtype).toBeUndefined()
  })
  it('mémoire épuisée ⇒ CRASH / RESOURCE_LIMIT', () => {
    expect(
      classify(input({ process: proc({ stderr: 'FATAL ERROR: JavaScript heap out of memory' }) }))
        .subtype,
    ).toBe('RESOURCE_LIMIT')
  })
})

describe('erreurs de la sonde et rejets non gérés (A-05, A-02)', () => {
  it('une erreur de la sonde est une erreur d’infrastructure, jamais un CRASH de la cible', () => {
    const r = classify(input({ probeErrors: 1 }))
    expect([r.status, r.reason]).toEqual(['INFRA_ERROR', 'PROBE_FAILURE'])
    expect(classify(input({ probeErrors: 0 })).status).toBe('CRASH')
  })
  const rejection = (over: object) =>
    ({
      type: 'UNHANDLED_REJECTION',
      error: err('TypeError', ['TypeError', 'Error']),
      ...over,
    }) as OracleInput['mutateEvents'][number]
  const returned = (callId: number) =>
    ({ ...call({ kind: 'return', async: false, value: true }), callId }) as ObservedCall
  it('rejet attribué à l’appel muté (ou à un appel qu’il a fait) ⇒ CRASH / UNHANDLED_REJECTION', () => {
    for (const r of [rejection({ callId: 4 }), rejection({ callId: 9, chain: [4, 9] })]) {
      const c = classify(input({ mutatedCall: returned(4), rejections: [r] }))
      expect([c.status, c.subtype, c.error?.name]).toEqual([
        'CRASH',
        'UNHANDLED_REJECTION',
        'TypeError',
      ])
    }
    const noError = classify(
      input({
        mutatedCall: returned(4),
        rejections: [{ ...rejection({ callId: 4 }), error: undefined }],
      }),
    )
    expect(noError.error).toBeUndefined()
  })
  it('rejet d’un autre appel, ou non attribué : ignoré ; un rejet ATTENDU reste distinct', () => {
    const other = classify(
      input({
        mutatedCall: returned(4),
        rejections: [rejection({ callId: 5, chain: [5] }), rejection({})],
      }),
    )
    expect(other.status).toBe('PASSED')
    const awaited = classify(
      input({
        mutatedCall: {
          ...call({
            kind: 'reject',
            async: true,
            error: err('ValidationError', ['ValidationError']),
          }),
          callId: 4,
        } as ObservedCall,
        rejections: [],
      }),
    )
    expect([awaited.status, awaited.outcome]).toEqual(['HANDLED', 'reject'])
  })
})

describe('HINT_VIOLATION strictement range / format / length (A-13)', () => {
  const ret = call({ kind: 'return', async: false, value: { ok: true } })
  const hint = { path: 'f#arg0.age', range: [0, 150] as [number, number] }
  it('un autre type ou un champ supprimé ne violent pas un hint de plage', () => {
    for (const m of [
      mutation({ strategy: 'type', value: '20', mutatedType: 'string', originalType: 'number' }),
      mutation({ strategy: 'undefined', op: 'delete', value: null, mutatedType: 'undefined' }),
    ]) {
      const r = classify(input({ mutation: m, mutatedCall: ret, hint }))
      expect([r.status, r.reason]).toEqual(['PASSED', undefined])
    }
  })
  it('format et longueur : violation seulement sur le bon type', () => {
    const fmt = { path: 'f#arg0.mail', format: 'email' as const }
    const len = { path: 'f#arg0.tags', length: [1, 2] as [number, number] }
    const r = (value: Json, h: Hint, mutatedType: string) =>
      classify(
        input({
          mutation: mutation({
            strategy: 'boundary',
            value,
            mutatedType,
            originalType: mutatedType,
          }),
          mutatedCall: ret,
          hint: h,
        }),
      ).reason
    expect([r('nope', fmt, 'string'), r(3, fmt, 'number')]).toEqual(['HINT_VIOLATION', undefined])
    expect([r([1, 2, 3], len, 'array'), r(['a'], len, 'array')]).toEqual([
      'HINT_VIOLATION',
      undefined,
    ])
  })
})

describe('limites de ressources (A-03)', () => {
  it('tas épuisé (toutes les formes du message de V8) ⇒ CRASH / RESOURCE_LIMIT', () => {
    for (const stderr of [
      'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
      'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - process out of memory',
      'Error [ERR_WORKER_OUT_OF_MEMORY]',
    ]) {
      const r = classify(
        input({ process: proc({ stderr, signal: 'SIGABRT' }), reportPresent: false }),
      )
      expect([r.status, r.subtype, r.reason]).toEqual(['CRASH', 'RESOURCE_LIMIT', 'OUT_OF_MEMORY'])
    }
  })
  it('sortie au-delà de max_output_bytes ⇒ CRASH / RESOURCE_LIMIT (OUTPUT_LIMIT)', () => {
    const r = classify(
      input({ process: proc({ outputTruncated: true, signal: 'SIGKILL' }), reportPresent: false }),
    )
    expect([r.status, r.subtype, r.reason]).toEqual(['CRASH', 'RESOURCE_LIMIT', 'OUTPUT_LIMIT'])
  })
})

describe('drapeau SLOW (A-10, CDC §18.9)', () => {
  const ok = call({ kind: 'return', async: false, value: 1 })
  const slow = (baselineTestMs: number | null, testDurationMs: number | null, cfg = {}) =>
    classify(input({ mutatedCall: ok, baselineTestMs, testDurationMs }), {
      ...DEFAULT_ORACLE,
      ...cfg,
    })
  it('au-dessus de k × baseline et du plancher : drapeau, statut inchangé', () => {
    expect(slow(20, 250)).toMatchObject({ status: 'PASSED', flags: ['SLOW'] })
  })
  it('au-dessous du facteur : pas de drapeau', () => {
    expect(slow(20, 150).flags).toBeUndefined()
  })
  it('plancher : un test très court multiplié reste sous le seuil absolu', () => {
    expect(slow(1, 90).flags).toBeUndefined()
    expect(slow(1, 90, { slowFloorMs: 50 }).flags).toEqual(['SLOW'])
    expect(slow(1, 30, { slowFactor: 2, slowFloorMs: 0 }).flags).toEqual(['SLOW'])
  })
  it('durées inconnues : jamais de drapeau', () => {
    expect([slow(null, 1000).flags, slow(10, null).flags]).toEqual([undefined, undefined])
  })
})
