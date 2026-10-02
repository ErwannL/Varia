import type { Json, ProbeEvent, SerializedError } from '@varia/probe-protocol'
import { stableStringify } from '@varia/probe-runtime'
import { violatesHint } from './hints.js'
import type { ObservedCall, OutcomeKind } from './observe.js'
import type { PlannedMutation } from './plan.js'
import type { ProcessResult } from './exec/proc.js'
import type { Hint } from './hints.js'

export type Status =
  | 'PASSED'
  | 'HANDLED'
  | 'EXPECTED_FAILURE'
  | 'UNEXPECTED_FAILURE'
  | 'CRASH'
  | 'TIMEOUT'
  | 'INFRA_ERROR'
  | 'SKIPPED'

export type Subtype =
  | 'SUSPICIOUS_ACCEPT'
  | 'RESOURCE_LIMIT'
  | 'UNHANDLED_REJECTION'
  | 'DEPENDENCY_ERROR'
  | 'PROCESS_EXIT'

export interface Classification {
  status: Status
  subtype?:
    | 'SUSPICIOUS_ACCEPT'
    | 'RESOURCE_LIMIT'
    | 'UNHANDLED_REJECTION'
    | 'DEPENDENCY_ERROR'
    | 'PROCESS_EXIT'
  reason?: string
  echoPath?: string
  outcome?: OutcomeKind
  error?: SerializedError
  /** Signal secondaire seulement (CDC §18.3-7) : jamais utilisé seul pour classer. */
  testStatus: string | null
}

export interface HandledRule {
  name?: string
  /** Expression régulière sur le nom (ou un nom de la chaîne de constructeurs). */
  namePattern?: string
  code?: string
  status?: number
  /** Expression régulière sur le message. */
  message?: string
}

export interface OracleConfig {
  handledErrors: string[]
  handledRules?: HandledRule[]
  crashErrors: string[]
  suspiciousAccept?: 'report' | 'ignore'
}

export const DEFAULT_ORACLE: OracleConfig = {
  handledErrors: [
    'ValidationError',
    'ZodError',
    'ValidationException',
    'ValueError',
    'InvalidArgumentException',
    'IllegalArgumentException',
  ],
  crashErrors: ['TypeError', 'ReferenceError', 'RangeError'],
}

export interface OracleInput {
  mutation: PlannedMutation
  process: ProcessResult
  hello: boolean
  reportPresent: boolean
  testStatus: string | null
  mutateEvents: ProbeEvent[]
  mutatedCall: ObservedCall | undefined
  hint?: Hint
  /** Erreurs du code de la sonde (`PROBE_ERROR`, ou marqueur sur stderr si le journal a échoué). */
  probeErrors?: number
  /** Rejets de promesse non gérés (`UNHANDLED_REJECTION`), attribués à un appel quand c'est possible. */
  rejections?: ProbeEvent[]
}

/** Épuisement du tas V8 (limite `--max-old-space-size` posée par `memory_mb`, CDC §16.3, A-03). */
const OUT_OF_MEMORY =
  /JavaScript heap out of memory|Reached heap limit|ERR_WORKER_OUT_OF_MEMORY|Allocation failed - process out of memory/

const BANAL = new Set(['null', JSON.stringify({ $t: 'undefined' }), '0', '""', 'true', 'false'])

/** Cherche, à toute profondeur, un nœud structurellement égal à `needle` ; renvoie son chemin. */
export function findEcho(haystack: Json, needle: Json, path = 'return'): string | null {
  if (stableStringify(haystack) === stableStringify(needle)) return path
  if (haystack === null || typeof haystack !== 'object') return null
  if (Array.isArray(haystack)) {
    for (let i = 0; i < haystack.length; i++) {
      const found = findEcho(haystack[i] ?? null, needle, `${path}[${i}]`)
      if (found !== null) return found
    }
    return null
  }
  const fields = haystack['$t'] === 'object' ? haystack['v'] : haystack
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return null
  if ('$t' in fields && haystack['$t'] !== 'object') return null
  for (const [k, v] of Object.entries(fields)) {
    const found = findEcho(v, needle, `${path}.${k}`)
    if (found !== null) return found
  }
  return null
}

/** Règle `handled_errors` (CDC §18.5) : nom, motif de nom, code, statut, message. */
export function matchesRule(r: HandledRule, e: SerializedError): boolean {
  const names = [e.name, ...e.constructorChain]
  if (r.name !== undefined && !names.includes(r.name)) return false
  if (
    r.namePattern !== undefined &&
    !names.some((n) => new RegExp(r.namePattern as string).test(n))
  )
    return false
  if (r.code !== undefined && e.code !== r.code) return false
  if (r.status !== undefined && e.status !== r.status) return false
  if (r.message !== undefined && !new RegExp(r.message).test(e.message)) return false
  return (
    r.name !== undefined ||
    r.namePattern !== undefined ||
    r.code !== undefined ||
    r.status !== undefined ||
    r.message !== undefined
  )
}

const inDependency = (e: SerializedError) =>
  (e.stack.split('\n').find((l) => l.trim().startsWith('at ')) ?? '').includes('node_modules')

/** Oracle (CDC §18) : ordre d'évaluation strict, le statut du test n'est qu'un signal secondaire. */
export function classify(i: OracleInput, cfg: OracleConfig = DEFAULT_ORACLE): Classification {
  const base = { testStatus: i.testStatus }
  if (!i.hello && !i.process.timedOut)
    return { ...base, status: 'INFRA_ERROR', reason: 'PROBE_NOT_STARTED' }
  // Erreur de VARIA (sonde), jamais comptée comme un comportement de la cible (CDC §44, A-05).
  if ((i.probeErrors ?? 0) > 0) return { ...base, status: 'INFRA_ERROR', reason: 'PROBE_FAILURE' }
  if (i.process.timedOut) return { ...base, status: 'TIMEOUT' }
  if (OUT_OF_MEMORY.test(i.process.stderr)) {
    return { ...base, status: 'CRASH', subtype: 'RESOURCE_LIMIT', reason: 'OUT_OF_MEMORY' }
  }
  // Sortie au-delà de `execution.max_output_bytes` : limite de ressources (CDC §16.3), pas une
  // simple troncature silencieuse.
  if (i.process.outputTruncated)
    return { ...base, status: 'CRASH', subtype: 'RESOURCE_LIMIT', reason: 'OUTPUT_LIMIT' }
  if (i.process.signal !== null || !i.reportPresent) {
    return {
      ...base,
      status: 'CRASH',
      subtype: 'PROCESS_EXIT',
      reason: `exit=${String(i.process.exitCode)} signal=${String(i.process.signal)}`,
    }
  }
  const applied = i.mutateEvents.find((e) => e.applied === true)
  if (!applied || !i.mutatedCall) {
    const reason = i.mutateEvents.find((e) => e.applied === false)?.reason ?? 'NOT_REACHED'
    return { ...base, status: 'SKIPPED', reason }
  }
  // Rejet non géré né de l'appel muté (ou d'un appel qu'il a fait) : signal de processus (§18.8).
  const callId = i.mutatedCall.callId
  const rejection = (i.rejections ?? []).find(
    (r) => r.callId === callId || (r.chain ?? []).includes(callId),
  )
  if (rejection !== undefined) {
    return {
      ...base,
      status: 'CRASH',
      subtype: 'UNHANDLED_REJECTION',
      ...(rejection.error !== undefined ? { error: rejection.error } : {}),
    }
  }
  const out = i.mutatedCall.outcome
  if (out.kind === 'throw' || out.kind === 'reject') {
    const err = out.error ?? { name: '', message: '', stack: '', constructorChain: [] }
    const names = [err.name, ...err.constructorChain]
    const dep = inDependency(err) ? { subtype: 'DEPENDENCY_ERROR' as const } : {}
    if (
      names.some((n) => cfg.handledErrors.includes(n)) ||
      (cfg.handledRules ?? []).some((r) => matchesRule(r, err))
    ) {
      return { ...base, status: 'HANDLED', outcome: out.kind, error: err, ...dep }
    }
    if (names.some((n) => cfg.crashErrors.includes(n))) {
      return { ...base, status: 'CRASH', outcome: out.kind, error: err, ...dep }
    }
    return { ...base, status: 'UNEXPECTED_FAILURE', outcome: out.kind, error: err, ...dep }
  }
  if (out.kind === 'none')
    return { ...base, status: 'UNEXPECTED_FAILURE', reason: 'TARGET_NO_OUTCOME' }
  const m = i.mutation
  if (cfg.suspiciousAccept === 'ignore') return { ...base, status: 'PASSED', outcome: out.kind }
  if (i.hint !== undefined && m.op === 'set' && violatesHint(i.hint, m.value)) {
    return {
      ...base,
      status: 'PASSED',
      subtype: 'SUSPICIOUS_ACCEPT',
      reason: 'HINT_VIOLATION',
      outcome: out.kind,
    }
  }
  const typeChanged =
    (m.strategy === 'type' || m.strategy === 'structure') && m.originalType !== m.mutatedType
  if (
    typeChanged &&
    m.op === 'set' &&
    !BANAL.has(stableStringify(m.value)) &&
    out.value !== undefined
  ) {
    const echoPath = findEcho(out.value, m.value)
    if (echoPath !== null) {
      return {
        ...base,
        status: 'PASSED',
        subtype: 'SUSPICIOUS_ACCEPT',
        reason: 'ECHO',
        echoPath,
        outcome: out.kind,
      }
    }
  }
  return { ...base, status: 'PASSED', outcome: out.kind }
}
