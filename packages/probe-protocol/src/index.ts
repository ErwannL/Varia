import { z } from 'zod'
import {
  currentEnvelopeSchema,
  foreignHelloSchema,
  MESSAGE_SCHEMAS,
  type MessageType,
  probeMessageSchema,
  PROTOCOL_VERSION,
  type Json,
  type SerializedError,
} from './messages.js'

export * from './messages.js'
export { conformanceDigest, type ConformanceManifest } from './conformance.js'

/**
 * Forme « à plat » d'un message lu (tous les champs propres à un type sont optionnels) : celle que
 * consomment le cœur et l'oracle. Chaque message validé y est assignable (vérifié à la compilation).
 * `protocolVersion` vaut la majeure courante, sauf pour un `HELLO` d'une majeure étrangère (P-03).
 */
export interface ProbeEvent {
  protocolVersion: number
  runId: string
  type: MessageType
  testId: string | null
  timestamp: string
  protocolMinor?: number | undefined
  callId?: number | undefined
  chain?: number[] | undefined
  callSiteId?: string | null | undefined
  module?: string | undefined
  export?: string | undefined
  depth?: number | undefined
  sequence?: number | undefined
  argsFingerprint?: string | undefined
  args?: Json[] | undefined
  argsOmitted?: boolean | undefined
  mutated?: boolean | undefined
  applied?: boolean | undefined
  reason?: string | undefined
  mutationId?: string | null | undefined
  expectedFingerprint?: string | undefined
  value?: Json | undefined
  async?: boolean | undefined
  error?: SerializedError | undefined
  wrapped?: string[] | undefined
  unsupported?: string[] | undefined
  file?: string | undefined
  name?: string | undefined
  durationMs?: number | undefined
  mode?: string | undefined
  pid?: number | undefined
}
/** Contrôle de compilation : tout message validé est un ProbeEvent. */
type IsEvent<T extends ProbeEvent> = T
export type ValidatedProbeEvent = IsEvent<z.infer<typeof probeMessageSchema>>

export interface ParsedLog {
  events: ProbeEvent[]
  /** Lignes tronquées (processus tué pendant l'écriture) : `PROBE_TRUNCATED`. */
  truncatedLines: number
  /** Lignes JSON valides mais hors schéma : `PROBE_INVALID`. */
  invalidLines: number
  /** Lignes de la majeure courante d'un type inconnu (mineure plus récente) : ignorées. */
  unknownTypeLines: number
}

const KNOWN = new Set<string>(Object.keys(MESSAGE_SCHEMAS))

/**
 * Valide un contenu JSONL ligne à ligne ; une ligne illisible est comptée, jamais devinée. Les champs
 * inconnus sont tolérés (retirés) ; un `HELLO` d'une autre majeure est conservé (enveloppe seule) pour
 * que l'orchestrateur refuse la sonde (`unsupportedProbeVersion`).
 */
export function parseProbeLog(content: string): ParsedLog {
  const events: ProbeEvent[] = []
  let truncatedLines = 0
  let invalidLines = 0
  let unknownTypeLines = 0
  for (const line of content.split('\n')) {
    if (line === '') continue
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      truncatedLines++
      continue
    }
    const parsed = probeMessageSchema.safeParse(raw)
    if (parsed.success) {
      events.push(parsed.data)
      continue
    }
    const foreign = foreignHelloSchema.safeParse(raw)
    if (foreign.success && foreign.data.protocolVersion !== PROTOCOL_VERSION) {
      events.push(foreign.data)
      continue
    }
    const env = currentEnvelopeSchema.safeParse(raw)
    if (env.success && !KNOWN.has(env.data.type)) unknownTypeLines++
    else invalidLines++
  }
  return { events, truncatedLines, invalidLines, unknownTypeLines }
}

/** Majeure annoncée par un `HELLO` que cette version de Varia ne sait pas lire ; `null` sinon. */
export function unsupportedProbeVersion(events: readonly ProbeEvent[]): number | null {
  const hello = events.find((e) => e.type === 'HELLO' && e.protocolVersion !== PROTOCOL_VERSION)
  return hello === undefined ? null : hello.protocolVersion
}

/** JSON Schema (2020-12) de chaque message, générés depuis les schémas Zod (jamais à la main). */
export function messageJsonSchemas(): Record<string, unknown> {
  const opts = { io: 'input', target: 'draft-2020-12', unrepresentable: 'any' } as const
  const out: Record<string, unknown> = {}
  for (const [type, schema] of Object.entries(MESSAGE_SCHEMAS))
    out[type] = z.toJSONSchema(schema, opts)
  out['PROBE_MESSAGE'] = z.toJSONSchema(probeMessageSchema, opts)
  return out
}

/** Nom du fichier publié d'un schéma : `OBSERVE_CALL` → `observe-call.schema.json`. */
export function schemaFileOf(type: string): string {
  return `${type.toLowerCase().replace(/_/g, '-')}.schema.json`
}

/** Variables d'environnement lues par la sonde (CDC D.0). */
export const PROBE_ENV = {
  mode: 'VARIA_MODE',
  runDir: 'VARIA_RUN_DIR',
  plan: 'VARIA_PLAN',
  mutationId: 'VARIA_MUTATION_ID',
  targets: 'VARIA_TARGETS',
  redact: 'VARIA_REDACT',
} as const
