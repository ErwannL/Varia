import { z } from 'zod'

/** Version du protocole sonde ↔ orchestrateur (CDC §10.6, §40). */
export const PROTOCOL_VERSION = 1

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

export const MESSAGE_TYPES = [
  'HELLO',
  'DISCOVER',
  'TEST_START',
  'TEST_END',
  'OBSERVE_CALL',
  'MUTATE_CALL',
  'TARGET_RETURN',
  'TARGET_THROW',
  'TARGET_REJECT',
  'PROBE_ERROR',
] as const
export type MessageType = (typeof MESSAGE_TYPES)[number]

const json: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(json),
    z.record(z.string(), json),
  ]),
)

export const serializedErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
  code: z.string().optional(),
  status: z.number().optional(),
  stack: z.string(),
  constructorChain: z.array(z.string()),
})
export type SerializedError = z.infer<typeof serializedErrorSchema>

/** Schéma d'une ligne JSONL écrite par la sonde. */
export const probeEventSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  runId: z.string(),
  type: z.enum(MESSAGE_TYPES),
  testId: z.string().nullable(),
  timestamp: z.string(),
  callId: z.number().int().optional(),
  callSiteId: z.string().nullable().optional(),
  module: z.string().optional(),
  export: z.string().optional(),
  depth: z.number().int().min(0).optional(),
  sequence: z.number().int().min(0).optional(),
  argsFingerprint: z.string().optional(),
  args: z.array(json).optional(),
  argsOmitted: z.boolean().optional(),
  mutated: z.boolean().optional(),
  applied: z.boolean().optional(),
  reason: z.string().optional(),
  mutationId: z.string().optional(),
  expectedFingerprint: z.string().optional(),
  value: json.optional(),
  async: z.boolean().optional(),
  error: serializedErrorSchema.optional(),
  wrapped: z.array(z.string()).optional(),
  unsupported: z.array(z.string()).optional(),
  file: z.string().optional(),
  name: z.string().optional(),
  durationMs: z.number().optional(),
  mode: z.string().optional(),
  pid: z.number().optional(),
})
export type ProbeEvent = z.infer<typeof probeEventSchema>

export interface ParsedLog {
  events: ProbeEvent[]
  /** Lignes tronquées (processus tué pendant l'écriture) : `PROBE_TRUNCATED`. */
  truncatedLines: number
  /** Lignes JSON valides mais hors schéma : `PROBE_INVALID`. */
  invalidLines: number
}

/** Valide un contenu JSONL ligne à ligne ; une ligne illisible est comptée, jamais devinée. */
export function parseProbeLog(content: string): ParsedLog {
  const events: ProbeEvent[] = []
  let truncatedLines = 0
  let invalidLines = 0
  for (const line of content.split('\n')) {
    if (line === '') continue
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      truncatedLines++
      continue
    }
    const parsed = probeEventSchema.safeParse(raw)
    if (parsed.success) events.push(parsed.data)
    else invalidLines++
  }
  return { events, truncatedLines, invalidLines }
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
