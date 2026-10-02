// Enregistrements partagés par l'écrivaine (orchestrateur) et la lectrice (API, rapports).
import type * as t from './schema.js'

export const J = JSON.stringify
export const now = () => new Date().toISOString()

export interface RunRecord {
  id: string
  projectId: string
  state: string
  mode: string
  seed: number | null
  gitCommit: string | null
  gitBranch: string | null
  variaVersion: string
  configHash: string
  envHash: string
  planPath: string | null
  partial: boolean
  info: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ResultRecord {
  mutationId: string
  status: string
  subtype: string | null
  reason: string | null
  outcome: string | null
  testStatus: string | null
  durationMs: number
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  error: unknown
  echoPath: string | null
  /** Drapeaux du résultat (`SLOW`, CDC §18.9) ; absents des enregistrements antérieurs à J3. */
  flags?: string[]
  /** Durée du test visé rapportée par le runner pendant la mutation. */
  testDurationMs?: number | null
}

export const toResult = (r: typeof t.mutationResults.$inferSelect): ResultRecord => ({
  ...r,
  timedOut: r.timedOut === 1,
  error: r.error === null ? null : (JSON.parse(r.error) as unknown),
  flags: JSON.parse(r.flags) as string[],
})

export interface IssueDraftRecord {
  fingerprint: string
  /** État calculé (§20.4) ; à défaut NEW/UNCHANGED selon que l'empreinte est connue. */
  state?: string
  kind: string
  severity: string
  target: string
  title: string
  errorName: string | null
  frame: string | null
  message: string | null
  mutationIds: string[]
}

export const toRun = (r: typeof t.runs.$inferSelect): RunRecord => ({
  ...r,
  partial: r.partial === 1,
  info: JSON.parse(r.info) as Record<string, unknown>,
})
