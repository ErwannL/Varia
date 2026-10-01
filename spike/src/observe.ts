import type { Json, ProbeEvent, SerializedError } from './events.js'
import type { JestRun } from './runner.js'
import { testIdOf } from './serialize.js'

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

export interface ObservedTest {
  testId: string
  file: string
  name: string
  status: string
}

export interface Observation {
  tests: ObservedTest[]
  calls: ObservedCall[]
  discovered: Record<string, { wrapped: string[]; unsupported: string[] }>
  mutateEvents: ProbeEvent[]
  truncatedLines: number
}

/** Tests de la sortie JSON de Jest, avec le même `testId` que la sonde (CDC §10.9). */
export function testsOf(run: JestRun, rel: (f: string) => string): ObservedTest[] {
  const out: ObservedTest[] = []
  for (const file of run.report?.testResults ?? []) {
    const relFile = rel(file.name)
    const counts = new Map<string, number>()
    for (const a of file.assertionResults) {
      const dup = counts.get(a.fullName) ?? 0
      counts.set(a.fullName, dup + 1)
      out.push({
        testId: testIdOf(relFile, a.fullName, dup),
        file: relFile,
        name: a.fullName,
        status: a.status,
      })
    }
  }
  return out
}

/** Reconstitue les appels observés (OBSERVE_CALL + issue TARGET_*) d'une exécution Jest. */
export function observationOf(run: JestRun, rel: (f: string) => string): Observation {
  const outcomes = new Map<number, Outcome>()
  const discovered: Observation['discovered'] = {}
  const mutateEvents: ProbeEvent[] = []
  for (const e of run.log.events) {
    if (e.type === 'TARGET_RETURN' && e.callId !== undefined) {
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
      discovered[e.module] = { wrapped: e.wrapped ?? [], unsupported: e.unsupported ?? [] }
    } else if (e.type === 'MUTATE_CALL') mutateEvents.push(e)
  }
  const calls: ObservedCall[] = []
  for (const e of run.log.events) {
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
    tests: testsOf(run, rel),
    calls,
    discovered,
    mutateEvents,
    truncatedLines: run.log.truncatedLines,
  }
}

export interface StabilityResult {
  flaky: { testId: string; name: string; reasons: string[] }[]
  nonDeterministicCallSites: string[]
}

/** Compare deux baselines (CDC §8.4) : statut, identité des call sites, empreintes d'arguments. */
export function compareBaselines(a: Observation, b: Observation): StabilityResult {
  const flaky: StabilityResult['flaky'] = []
  const nonDeterministicCallSites: string[] = []
  const byTest = (o: Observation) => {
    const m = new Map<string, Map<string, string>>()
    for (const c of o.calls) {
      const sites = m.get(c.testId) ?? new Map<string, string>()
      sites.set(c.callSiteId, c.argsFingerprint)
      m.set(c.testId, sites)
    }
    return m
  }
  const ca = byTest(a)
  const cb = byTest(b)
  const statusB = new Map(b.tests.map((t) => [t.testId, t.status]))
  for (const t of a.tests) {
    const reasons: string[] = []
    if (statusB.get(t.testId) !== t.status) reasons.push('STATUS_CHANGED')
    const sa = ca.get(t.testId) ?? new Map<string, string>()
    const sb = cb.get(t.testId) ?? new Map<string, string>()
    const ids = new Set([...sa.keys(), ...sb.keys()])
    for (const id of ids) {
      if (!sa.has(id) || !sb.has(id)) reasons.push('CALL_SITES_CHANGED')
      else if (sa.get(id) !== sb.get(id)) {
        reasons.push('NON_DETERMINISTIC_INPUT')
        nonDeterministicCallSites.push(id)
      }
    }
    if (reasons.length > 0)
      flaky.push({ testId: t.testId, name: t.name, reasons: [...new Set(reasons)].sort() })
  }
  return { flaky, nonDeterministicCallSites: nonDeterministicCallSites.sort() }
}
