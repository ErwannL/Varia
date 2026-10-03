import { z } from 'zod'

/**
 * Version MAJEURE du protocole : présente sur CHAQUE ligne (`protocolVersion`). Une sonde d'une
 * version majeure inconnue est refusée (`UNSUPPORTED_PROBE`, P-03).
 */
export const PROTOCOL_VERSION = 1
/**
 * Version MINEURE : annoncée dans `HELLO` (`protocolMinor`, absente ⇒ 0). Une mineure plus récente
 * n'ajoute que des champs ou des types de messages optionnels : un lecteur plus ancien les ignore.
 * 1.1 : `protocolMinor`, schémas par message, jeu de conformité (P-01 à P-03).
 * 1.2 : redaction des clés textuelles de Map (avant : valeur écrite en clair).
 */
export const PROTOCOL_MINOR = 2
/** Version complète, telle qu'écrite dans le manifeste de conformité. */
export const PROTOCOL_VERSION_STRING = `${PROTOCOL_VERSION}.${PROTOCOL_MINOR}`

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

/**
 * Une valeur observée est une DONNÉE HOSTILE (clés `constructor`, `__proto__`, …) : elle est vérifiée par
 * un parcours défensif, jamais par une validation qui lirait ses propriétés héritées.
 */
export function isJsonValue(v: unknown, depth = 0): v is Json {
  if (depth > 200) return false
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (Array.isArray(v)) return v.every((x) => isJsonValue(x, depth + 1))
  if (typeof v !== 'object') return false
  return Object.keys(v).every((k) =>
    isJsonValue(Object.getOwnPropertyDescriptor(v, k)?.value, depth + 1),
  )
}

/** Valeur sérialisée (étiquetée, §10.7) : tout JSON ; décrite dans `docs/probe-protocol.md`. */
export const jsonValueSchema = z
  .custom<Json>((v) => isJsonValue(v))
  .meta({
    title: 'TaggedValue',
    description: 'Valeur JSON étiquetée ($t, $redacted) — voir la norme',
  })

export const serializedErrorSchema = z
  .object({
    name: z.string(),
    message: z.string(),
    code: z.string().optional(),
    status: z.number().optional(),
    /** Pile filtrée (cadres de la sonde et du runner retirés), secrets masqués. */
    stack: z.string(),
    /** Noms des constructeurs, du plus dérivé au plus général (racine universelle exclue). */
    constructorChain: z.array(z.string()),
  })
  .meta({ title: 'SerializedError' })
export type SerializedError = z.infer<typeof serializedErrorSchema>

const int = () => z.number().int()
const nat = () => z.number().int().min(0)
const hex64 = () => z.string().regex(/^[0-9a-f]{64}$/)
const callSiteId = () => z.string().regex(/^c_[0-9a-f]{16}$/)

/** Champs communs à toutes les lignes (enveloppe). `testId` : `null` hors d'un test. */
const envelope = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  runId: z.string(),
  testId: z
    .string()
    .regex(/^t_[0-9a-f]{16}$/)
    .nullable(),
  /** Horodatage ISO-8601 (UTC conseillé) : jamais utilisé pour décider, seulement affiché. */
  timestamp: z.string().min(1),
}

const message = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ ...envelope, type: z.literal(type), ...shape }).meta({ title: type })

export const helloSchema = message('HELLO', {
  protocolMinor: nat().optional(),
  mode: z.enum(['observe', 'fuzz']),
  pid: nat(),
  mutationId: z.string().nullable(),
})
export const discoverSchema = message('DISCOVER', {
  module: z.string(),
  wrapped: z.array(z.string()),
  unsupported: z.array(z.string()),
})
export const testStartSchema = message('TEST_START', { file: z.string(), name: z.string() })
export const testEndSchema = message('TEST_END', {})
export const observeCallSchema = message('OBSERVE_CALL', {
  callId: int().min(1),
  callSiteId: callSiteId().nullable(),
  module: z.string(),
  export: z.string(),
  depth: nat(),
  sequence: nat(),
  argsFingerprint: hex64(),
  mutated: z.boolean(),
  /** Absent au-delà du plafond d'appels journalisés : `argsOmitted: true`. */
  args: z.array(jsonValueSchema).optional(),
  argsOmitted: z.literal(true).optional(),
})
export const mutateCallSchema = message('MUTATE_CALL', {
  callId: int().min(1),
  callSiteId: callSiteId(),
  mutationId: z.string(),
  applied: z.boolean(),
  /** Refus : `AMBIGUOUS_CALL_SITE`, `PATH_NOT_FOUND` (liste ouverte : une mineure peut en ajouter). */
  reason: z.string().optional(),
  expectedFingerprint: hex64().optional(),
  argsFingerprint: hex64().optional(),
})
const outcome = {
  callId: int().min(1),
  callSiteId: callSiteId().nullable(),
  durationMs: z.number().min(0),
}
export const targetReturnSchema = message('TARGET_RETURN', {
  ...outcome,
  async: z.boolean(),
  value: jsonValueSchema,
})
export const targetThrowSchema = message('TARGET_THROW', {
  ...outcome,
  error: serializedErrorSchema,
})
export const targetRejectSchema = message('TARGET_REJECT', {
  ...outcome,
  error: serializedErrorSchema,
})
export const probeErrorSchema = message('PROBE_ERROR', {
  /** Étape de la sonde en échec : `prepare`, `outcome`, `wrap`, `unhandled-rejection`… */
  reason: z.string(),
  error: serializedErrorSchema,
  module: z.string().optional(),
  export: z.string().optional(),
  callId: int().min(1).optional(),
})
export const unhandledRejectionSchema = message('UNHANDLED_REJECTION', {
  callId: int().min(1).optional(),
  callSiteId: callSiteId().nullable(),
  /** Appels englobants (attribution au contexte asynchrone, A-02), du plus externe au plus interne. */
  chain: z.array(int().min(1)),
  error: serializedErrorSchema,
})

/** Un schéma par type de message (P-01). */
export const MESSAGE_SCHEMAS = {
  HELLO: helloSchema,
  DISCOVER: discoverSchema,
  TEST_START: testStartSchema,
  TEST_END: testEndSchema,
  OBSERVE_CALL: observeCallSchema,
  MUTATE_CALL: mutateCallSchema,
  TARGET_RETURN: targetReturnSchema,
  TARGET_THROW: targetThrowSchema,
  TARGET_REJECT: targetRejectSchema,
  PROBE_ERROR: probeErrorSchema,
  UNHANDLED_REJECTION: unhandledRejectionSchema,
} as const
export type MessageType = keyof typeof MESSAGE_SCHEMAS
export const MESSAGE_TYPES = Object.keys(MESSAGE_SCHEMAS) as MessageType[]

/** Union discriminée sur `type` ; les champs inconnus sont tolérés (retirés à la lecture). */
export const probeMessageSchema = z.discriminatedUnion('type', [
  helloSchema,
  discoverSchema,
  testStartSchema,
  testEndSchema,
  observeCallSchema,
  mutateCallSchema,
  targetReturnSchema,
  targetThrowSchema,
  targetRejectSchema,
  probeErrorSchema,
  unhandledRejectionSchema,
])
export type ProbeMessage = z.infer<typeof probeMessageSchema>

/**
 * Enveloppe minimale d'un `HELLO` de N'IMPORTE QUELLE version majeure : invariant permanent du
 * protocole, qui permet de refuser clairement une sonde d'une autre majeure (P-03).
 */
export const foreignHelloSchema = z.object({
  protocolVersion: int().min(1),
  runId: z.string(),
  type: z.literal('HELLO'),
  testId: z.string().nullable(),
  timestamp: z.string(),
})

/** Enveloppe d'une ligne de la version majeure courante, de type éventuellement inconnu. */
export const currentEnvelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.string(),
})
