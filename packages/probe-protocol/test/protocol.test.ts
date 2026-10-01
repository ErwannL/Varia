import { describe, expect, it } from 'vitest'
import { parseProbeLog, PROTOCOL_VERSION } from '../src/index.js'

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
  it('refuse une profondeur négative', () => {
    expect(parseProbeLog(line({ type: 'OBSERVE_CALL', depth: -1 })).invalidLines).toBe(1)
  })
})
