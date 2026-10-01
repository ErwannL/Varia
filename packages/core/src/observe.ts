import type { Json, ProbeEvent, SerializedError } from '@varia/probe-protocol'
import type { AdapterRun, TestResult } from './adapter.js'

export type OutcomeKind = 'return' | 'throw' | 'reject' | 'none'

export interface Outcome {
  kind: OutcomeKind
  async: boolean
  value?: Json
  error?: SerializedError
}

export interface ObservedCall {
  callId: number
  callSiteId: string
  testId: string
  module: string
  export: string
  depth: number
  sequence: number
  argsFingerprint: string
  args: Json[] | null
  mutated: boolean
  outcome: Outcome
}

export interface Observation {
  tests: TestResult[]
  calls: ObservedCall[]
  discovered: Record<string, { wrapped: string[]; unsupported: string[] }>
  mutateEvents: ProbeEvent[]
  helloCount: number
  truncatedLines: number
  invalidLines: number
}

/** Reconstitue les appels observés (OBSERVE_CALL + issue TARGET_*) d'une exécution. */
export function observationOf(run: AdapterRun): Observation {
  const outcomes = new Map<number, Outcome>()
  const discovered: Observation['discovered'] = {}
  const mutateEvents: ProbeEvent[] = []
  let helloCount = 0
  for (const e of run.events) {
    if (e.type === 'HELLO') helloCount++
    else if (e.type === 'TARGET_RETURN' && e.callId !== undefined) {
      outcomes.set(e.callId, {
        kind: 'return',
        async: e.async === true,
        ...(e.value !== undefined ? { value: e.value } : {}),
      })
    } else if (
      (e.type === 'TARGET_THROW' || e.type === 'TARGET_REJECT') &&
      e.callId !== undefined
    ) {
      outcomes.set(e.callId, {
        kind: e.type === 'TARGET_THROW' ? 'throw' : 'reject',
        async: e.type === 'TARGET_REJECT',
        ...(e.error !== undefined ? { error: e.error } : {}),
      })
    } else if (e.type === 'DISCOVER' && e.module !== undefined) {
      // Fusion : un module CommonJS s'annonce en une fois, un module ESM export par export.
      const d = discovered[e.module] ?? { wrapped: [], unsupported: [] }
      discovered[e.module] = {
        wrapped: [...new Set([...d.wrapped, ...(e.wrapped ?? [])])],
        unsupported: [...new Set([...d.unsupported, ...(e.unsupported ?? [])])],
      }
    } else if (e.type === 'MUTATE_CALL') mutateEvents.push(e)
  }
  const calls: ObservedCall[] = []
  for (const e of run.events) {
    if (e.type !== 'OBSERVE_CALL' || e.callSiteId == null || e.testId === null) continue
    calls.push({
      callId: e.callId ?? 0,
      callSiteId: e.callSiteId,
      testId: e.testId,
      module: e.module ?? '',
      export: e.export ?? '',
      depth: e.depth ?? 0,
      sequence: e.sequence ?? 0,
      argsFingerprint: e.argsFingerprint ?? '',
      args: e.args ?? null,
      mutated: e.mutated === true,
      outcome: outcomes.get(e.callId ?? -1) ?? { kind: 'none', async: false },
    })
  }
  return {
    tests: run.tests ?? [],
    calls,
    discovered,
    mutateEvents,
    helloCount,
    truncatedLines: run.truncatedLines,
    invalidLines: run.invalidLines,
  }
}

export type FlakyReason = 'STATUS_CHANGED' | 'CALL_SITES_CHANGED' | 'NON_DETERMINISTIC_INPUT'

export interface StabilityResult {
  flaky: { testId: string; name: string; reasons: FlakyReason[] }[]
  nonDeterministicCallSites: string[]
}

/** Compare des baselines (CDC §8.4) : statut, identité des call sites, empreintes d'arguments. */
export function compareBaselines(runs: Observation[]): StabilityResult {
  const [first, ...rest] = runs
  if (first === undefined) return { flaky: [], nonDeterministicCallSites: [] }
  const byTest = (o: Observation) => {
    const m = new Map<string, Map<string, string>>()
    for (const c of o.calls) {
      const sites = m.get(c.testId) ?? new Map<string, string>()
      sites.set(c.callSiteId, c.argsFingerprint)
      m.set(c.testId, sites)
    }
    return m
  }
  const reasons = new Map<string, Set<FlakyReason>>()
  const nd = new Set<string>()
  const ca = byTest(first)
  for (const other of rest) {
    const cb = byTest(other)
    const statusB = new Map(other.tests.map((t) => [t.testId, t.status]))
    for (const t of first.tests) {
      const r = reasons.get(t.testId) ?? new Set<FlakyReason>()
      if (statusB.get(t.testId) !== t.status) r.add('STATUS_CHANGED')
      const sa = ca.get(t.testId) ?? new Map<string, string>()
      const sb = cb.get(t.testId) ?? new Map<string, string>()
      for (const id of new Set([...sa.keys(), ...sb.keys()])) {
        if (!sa.has(id) || !sb.has(id)) r.add('CALL_SITES_CHANGED')
        else if (sa.get(id) !== sb.get(id)) {
          r.add('NON_DETERMINISTIC_INPUT')
          nd.add(id)
        }
      }
      if (r.size > 0) reasons.set(t.testId, r)
    }
  }
  const flaky = first.tests
    .filter((t) => reasons.has(t.testId))
    .map((t) => ({
      testId: t.testId,
      name: t.name,
      reasons: [...(reasons.get(t.testId) ?? [])].sort(),
    }))
  return { flaky, nonDeterministicCallSites: [...nd].sort() }
}
