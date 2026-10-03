// Doubles de sonde (T-01) : messages du protocole et exécution d'adapter scriptée, pour tester une
// extension ou un composant sans lancer de vrai runner de tests.
import type { AdapterRun, ObservedCall, TestResult } from '@varia/core'
import {
  PROTOCOL_VERSION,
  type Json,
  type ProbeEvent,
  type SerializedError,
} from '@varia/probe-protocol'

const NOW = '2026-01-01T00:00:00.000Z'

/** Message de sonde (enveloppe complète, horodatage fixe : doubles déterministes). */
export function probeEvent(type: ProbeEvent['type'], fields: Partial<ProbeEvent> = {}): ProbeEvent {
  return {
    protocolVersion: PROTOCOL_VERSION,
    runId: 'testkit',
    type,
    testId: null,
    timestamp: NOW,
    ...fields,
  }
}

const ofCall = (c: ObservedCall) => ({ callId: c.callId, testId: c.testId })

/** Messages usuels construits depuis un call site (`callSite()`). */
export const probe = {
  hello: (): ProbeEvent => probeEvent('HELLO', { pid: 1, mode: 'fuzz' }),
  observeCall: (c: ObservedCall): ProbeEvent =>
    probeEvent('OBSERVE_CALL', {
      ...ofCall(c),
      callSiteId: c.callSiteId,
      module: c.module,
      export: c.export,
      depth: c.depth,
      sequence: c.sequence,
      argsFingerprint: c.argsFingerprint,
      ...(c.args !== null ? { args: c.args } : {}),
      mutated: c.mutated,
    }),
  mutateCall: (c: ObservedCall, mutationId: string, applied = true, reason?: string) =>
    probeEvent('MUTATE_CALL', {
      ...ofCall(c),
      callSiteId: c.callSiteId,
      mutationId,
      applied,
      ...(reason !== undefined ? { reason } : {}),
    }),
  targetReturn: (c: ObservedCall, value: Json, async = false): ProbeEvent =>
    probeEvent('TARGET_RETURN', { ...ofCall(c), value, async }),
  targetThrow: (c: ObservedCall, error: SerializedError): ProbeEvent =>
    probeEvent('TARGET_THROW', { ...ofCall(c), error }),
  targetReject: (c: ObservedCall, error: SerializedError): ProbeEvent =>
    probeEvent('TARGET_REJECT', { ...ofCall(c), error }),
}

/**
 * Erreur sérialisée selon les règles du protocole : nom, message, code, statut, pile, chaîne des
 * constructeurs (jamais d'`instanceof` côté oracle).
 */
export function serializedError(e: Error & { code?: unknown; status?: unknown }): SerializedError {
  const chain: string[] = []
  for (let p = Object.getPrototypeOf(e) as object | null; p !== null; p = Object.getPrototypeOf(p))
    if (p !== Object.prototype) chain.push((p.constructor as { name: string }).name)
  return {
    name: e.name,
    message: e.message,
    stack: e.stack ?? '',
    constructorChain: chain,
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
    ...(typeof e.status === 'number' ? { status: e.status } : {}),
  }
}

export interface AdapterRunOptions {
  events: ProbeEvent[]
  tests?: TestResult[] | null
  exitCode?: number | null
  signal?: string | null
  timedOut?: boolean
  stderr?: string
}

/** Résultat d'exécution d'un adapter (ce que `TestAdapter.run` rend), scripté. */
export function adapterRun(o: AdapterRunOptions): AdapterRun {
  return {
    process: {
      exitCode: o.exitCode === undefined ? 0 : o.exitCode,
      signal: o.signal ?? null,
      timedOut: o.timedOut ?? false,
      durationMs: 1,
      stdout: '',
      stderr: o.stderr ?? '',
      outputTruncated: false,
      pid: 1,
    },
    tests: o.tests === undefined ? [] : o.tests,
    events: o.events,
    truncatedLines: 0,
    invalidLines: 0,
  }
}
