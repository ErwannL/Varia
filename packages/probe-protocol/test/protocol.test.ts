import { describe, expect, it } from 'vitest'
import { isJsonValue, parseProbeLog, PROTOCOL_VERSION } from '../src/index.js'

const line = (o: Record<string, unknown>) =>
  JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    runId: 'r',
    type: 'HELLO',
    testId: null,
    timestamp: 't',
    ...o,
  })

describe('parseProbeLog', () => {
  it('valide les lignes, compte les tronquées et les invalides', () => {
    const content = [
      line({}),
      line({ type: 'OBSERVE_CALL', depth: 0, args: [1, { a: null }] }),
      '{"protocolVersion":1,"ru',
      line({ type: 'NOPE' }),
      '',
    ].join('\n')
    const r = parseProbeLog(content)
    expect(r.events.map((e) => e.type)).toEqual(['HELLO', 'OBSERVE_CALL'])
    expect(r.truncatedLines).toBe(1)
    expect(r.invalidLines).toBe(1)
  })
  it('refuse une autre version de protocole', () => {
    expect(parseProbeLog(line({ protocolVersion: 99 })).invalidLines).toBe(1)
  })
  it('données hostiles : constructor null, __proto__, prototype — validées sans planter', () => {
    const hostile = '{"constructor":null,"__proto__":{"polluted":true},"prototype":null}'
    const r = parseProbeLog(
      line({ type: 'OBSERVE_CALL', args: [JSON.parse(hostile)], value: JSON.parse(hostile) }),
    )
    expect(r.events).toHaveLength(1)
    expect(Object.keys((r.events[0]?.args?.[0] ?? {}) as object)).toEqual([
      'constructor',
      '__proto__',
      'prototype',
    ])
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
  it('isJsonValue refuse ce qui n’est pas du JSON', () => {
    expect(isJsonValue(NaN)).toBe(false)
    expect(isJsonValue(() => 1)).toBe(false)
    expect(isJsonValue({ a: [1, { b: undefined }] })).toBe(false)
    expect(isJsonValue([[[{ a: 'x' }]]])).toBe(true)
  })
  it('refuse une profondeur négative', () => {
    expect(parseProbeLog(line({ type: 'OBSERVE_CALL', depth: -1 })).invalidLines).toBe(1)
  })
})
