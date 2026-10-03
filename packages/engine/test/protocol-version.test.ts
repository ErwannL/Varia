// P-03 : Varia refuse une sonde d'une version MAJEURE inconnue (UNSUPPORTED_PROBE, code 5) et accepte
// une version mineure plus récente porteuse de champs inconnus. Les événements passent par le VRAI
// lecteur de journaux (`parseProbeLog`), comme ceux d'un adaptateur.
import { parseProbeLog, PROTOCOL_VERSION } from '@varia/probe-protocol'
import { describe, expect, it } from 'vitest'
import { doctor, EXIT, runBaseline, VariaError } from '../src/index.js'
import { context, FakeAdapter, observeRun, type FakeTest } from './fake.js'

const TESTS: FakeTest[] = [{ name: 'a', calls: [{ export: 'f', args: [{ name: 'Ada' }] }] }]

/** Journal relu : le HELLO de la baseline factice est remplacé par la ligne JSONL donnée. */
function runWithHello(hello: Record<string, unknown>) {
  const run = observeRun(TESTS)
  const line = JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    runId: 'r',
    type: 'HELLO',
    testId: null,
    timestamp: '2026-01-01T00:00:00.000Z',
    mode: 'observe',
    pid: 1,
    mutationId: null,
    ...hello,
  })
  const parsed = parseProbeLog(line)
  expect(parsed.invalidLines).toBe(0)
  run.events = [...parsed.events, ...run.events.filter((e) => e.type !== 'HELLO')]
  return run
}

describe('version du protocole de sonde (P-03)', () => {
  it('majeure inconnue : UNSUPPORTED_PROBE, code de sortie 5, message et détail clairs', async () => {
    const ctx = context(new FakeAdapter(() => runWithHello({ protocolVersion: 2 })))
    const err = await runBaseline(ctx).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(VariaError)
    const e = err as VariaError
    expect([e.kind, e.exitCode, EXIT.UNSUPPORTED]).toEqual(['UNSUPPORTED_PROBE', 5, 5])
    expect(e.message).toContain('version du protocole')
    expect(e.details).toEqual([
      'PROBE_PROTOCOL_UNSUPPORTED: protocolVersion 2 (pris en charge : 1)',
    ])
    expect(ctx.reader.listRuns(1)[0]?.state).toBe('FAILED')
    ctx.close()
  })
  it('mineure plus récente avec des champs inconnus : acceptée, baseline normale', async () => {
    const ctx = context(
      new FakeAdapter(() => runWithHello({ protocolMinor: 42, capabilities: ['x'], extra: {} })),
    )
    const b = await runBaseline(ctx)
    expect([b.state, b.calls]).toEqual(['BASELINE_DONE', 1])
    ctx.close()
  })
  it('doctor : majeure inconnue ⇒ verdict UNSUPPORTED_PROBE, raison dédiée', async () => {
    const ctx = context(new FakeAdapter(() => runWithHello({ protocolVersion: 9 })))
    const r = await doctor(ctx)
    ctx.close()
    expect(r.verdict).toBe('UNSUPPORTED_PROBE')
    expect(r.reasons).toContain('PROBE_PROTOCOL_UNSUPPORTED')
    expect(r.verified.observation).toBe('UNSUPPORTED')
    expect(r.checks.observation.reason).toBe('PROBE_PROTOCOL_UNSUPPORTED')
  })
})
