import { describe, expect, it } from 'vitest'
import {
  isJsonValue,
  MESSAGE_SCHEMAS,
  MESSAGE_TYPES,
  parseProbeLog,
  PROTOCOL_MINOR,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_STRING,
  unsupportedProbeVersion,
  type ProbeEvent,
} from '../src/index.js'

const T = 't_0123456789abcdef'
const C = 'c_0123456789abcdef'
const H = 'a'.repeat(64)
const ERR = { name: 'TypeError', message: 'x', stack: '', constructorChain: ['TypeError', 'Error'] }

/** Un exemple valide de chaque message, tel que la sonde l'écrit (champs obligatoires seulement). */
const SAMPLES: Record<string, Record<string, unknown>> = {
  HELLO: { mode: 'observe', pid: 12, mutationId: null, protocolMinor: PROTOCOL_MINOR },
  DISCOVER: { module: 'src/a.js', wrapped: ['f'], unsupported: [] },
  TEST_START: { testId: T, file: 'a.test.js', name: 'a' },
  TEST_END: { testId: T },
  OBSERVE_CALL: {
    testId: T,
    callId: 1,
    callSiteId: C,
    module: 'src/a.js',
    export: 'f',
    depth: 0,
    sequence: 0,
    argsFingerprint: H,
    mutated: false,
    args: [1, { $t: 'undefined' }],
  },
  MUTATE_CALL: { callId: 1, callSiteId: C, mutationId: 'm1', applied: true },
  TARGET_RETURN: { callId: 1, callSiteId: null, durationMs: 0.5, async: false, value: null },
  TARGET_THROW: { callId: 1, callSiteId: C, durationMs: 1, error: ERR },
  TARGET_REJECT: { callId: 1, callSiteId: C, durationMs: 1, error: ERR },
  PROBE_ERROR: { reason: 'prepare', error: ERR },
  UNHANDLED_REJECTION: { callSiteId: null, chain: [], error: ERR },
}

const msg = (type: string, o: Record<string, unknown> = {}) => ({
  protocolVersion: PROTOCOL_VERSION,
  runId: 'r',
  type,
  testId: null,
  timestamp: '2026-01-01T00:00:00.000Z',
  ...SAMPLES[type],
  ...o,
})
const line = (type: string, o: Record<string, unknown> = {}) => JSON.stringify(msg(type, o))

describe('versions (P-03)', () => {
  it('majeure 1, mineure 2, chaîne « 1.2 »', () => {
    expect([PROTOCOL_VERSION, PROTOCOL_MINOR, PROTOCOL_VERSION_STRING]).toEqual([1, 2, '1.2'])
  })
})

describe('un schéma par message (P-01)', () => {
  it('chaque type a un schéma et un exemple valide', () => {
    expect(MESSAGE_TYPES).toEqual(Object.keys(SAMPLES))
    for (const type of MESSAGE_TYPES) {
      const r = parseProbeLog(line(type))
      expect([type, r.invalidLines, r.events.length]).toEqual([type, 0, 1])
      expect(MESSAGE_SCHEMAS[type].safeParse(msg(type)).success).toBe(true)
    }
  })
  it.each([
    ['HELLO', 'mode'],
    ['HELLO', 'pid'],
    ['DISCOVER', 'wrapped'],
    ['TEST_START', 'name'],
    ['OBSERVE_CALL', 'argsFingerprint'],
    ['OBSERVE_CALL', 'mutated'],
    ['MUTATE_CALL', 'applied'],
    ['TARGET_RETURN', 'value'],
    ['TARGET_RETURN', 'async'],
    ['TARGET_THROW', 'error'],
    ['PROBE_ERROR', 'reason'],
    ['UNHANDLED_REJECTION', 'chain'],
  ])('%s sans « %s » : hors schéma', (type, field) => {
    const o = Object.fromEntries(Object.entries(msg(type)).filter(([k]) => k !== field))
    expect(parseProbeLog(JSON.stringify(o)).invalidLines).toBe(1)
  })
  it.each([
    ['OBSERVE_CALL', { depth: -1 }],
    ['OBSERVE_CALL', { argsFingerprint: 'abc' }],
    ['OBSERVE_CALL', { callSiteId: 'x' }],
    ['OBSERVE_CALL', { callId: 0 }],
    ['HELLO', { mode: 'replay' }],
    ['HELLO', { testId: 'pas-un-id' }],
    ['TARGET_RETURN', { durationMs: -1 }],
    ['TARGET_THROW', { error: { name: 'E', message: 'm', stack: '' } }],
  ])('%s %j : hors schéma', (type, o) => {
    expect(parseProbeLog(line(type, o)).invalidLines).toBe(1)
  })
  it('HELLO sans protocolMinor (sonde 1.0) : accepté', () => {
    expect(parseProbeLog(line('HELLO', { protocolMinor: undefined })).events).toHaveLength(1)
  })
})

describe('parseProbeLog', () => {
  it('compte les lignes tronquées, invalides et de type inconnu', () => {
    const content = [
      line('HELLO'),
      line('OBSERVE_CALL'),
      '{"protocolVersion":1,"ru',
      line('NOPE'),
      JSON.stringify({ type: 'OBSERVE_CALL' }),
      '',
    ].join('\n')
    const r = parseProbeLog(content)
    expect(r.events.map((e) => e.type)).toEqual(['HELLO', 'OBSERVE_CALL'])
    expect([r.truncatedLines, r.invalidLines, r.unknownTypeLines]).toEqual([1, 1, 1])
  })
  it('mineure plus récente : champs inconnus tolérés (retirés), le message est lu', () => {
    const r = parseProbeLog(
      [
        line('HELLO', { protocolMinor: 9, futureField: { a: 1 } }),
        line('TARGET_RETURN', { retries: 3 }),
      ].join('\n'),
    )
    expect(r.invalidLines).toBe(0)
    expect(r.events).toHaveLength(2)
    expect(r.events[0]).toMatchObject({ type: 'HELLO', protocolMinor: 9 })
    expect(r.events[0]).not.toHaveProperty('futureField')
    expect(r.events[1]).not.toHaveProperty('retries')
  })
  it('majeure étrangère : HELLO conservé (enveloppe seule), autres lignes invalides', () => {
    const r = parseProbeLog(
      [
        line('HELLO', { protocolVersion: 2, mode: 'autre' }),
        line('TEST_END', { protocolVersion: 2 }),
      ].join('\n'),
    )
    expect(r.events).toEqual([
      {
        protocolVersion: 2,
        runId: 'r',
        type: 'HELLO',
        testId: null,
        timestamp: msg('HELLO').timestamp,
      },
    ])
    expect(r.invalidLines).toBe(1)
    expect(unsupportedProbeVersion(r.events)).toBe(2)
  })
  it('HELLO de majeure étrangère sans enveloppe complète : invalide', () => {
    const r = parseProbeLog(JSON.stringify({ protocolVersion: 3, type: 'HELLO' }))
    expect([r.events.length, r.invalidLines]).toEqual([0, 1])
    expect(parseProbeLog(line('HELLO', { protocolVersion: 0 })).invalidLines).toBe(1)
  })
  it('unsupportedProbeVersion : null pour la majeure courante ou sans HELLO', () => {
    expect(unsupportedProbeVersion(parseProbeLog(line('HELLO')).events)).toBeNull()
    expect(unsupportedProbeVersion([])).toBeNull()
    const other = { ...msg('TEST_END'), protocolVersion: 7 } as unknown as ProbeEvent
    expect(unsupportedProbeVersion([other])).toBeNull()
  })
  it('données hostiles : constructor null, __proto__, prototype — validées sans planter', () => {
    const hostile = '{"constructor":null,"__proto__":{"polluted":true},"prototype":null}'
    const r = parseProbeLog(line('OBSERVE_CALL', { args: [JSON.parse(hostile)] }))
    expect(r.events).toHaveLength(1)
    expect(Object.keys((r.events[0]?.args?.[0] ?? {}) as object)).toEqual([
      'constructor',
      '__proto__',
      'prototype',
    ])
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    expect(
      parseProbeLog(line('TARGET_RETURN', { value: JSON.parse(hostile) })).events,
    ).toHaveLength(1)
  })
  it('isJsonValue refuse ce qui n’est pas du JSON', () => {
    expect(isJsonValue(NaN)).toBe(false)
    expect(isJsonValue(() => 1)).toBe(false)
    expect(isJsonValue({ a: [1, { b: undefined }] })).toBe(false)
    expect(isJsonValue([[[{ a: 'x' }]]])).toBe(true)
    let deep: unknown = 1
    for (let i = 0; i < 250; i++) deep = [deep]
    expect(isJsonValue(deep)).toBe(false)
  })
})
