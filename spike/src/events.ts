import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

export interface SerializedError {
  name: string
  message: string
  code?: string
  status?: number
  stack: string
  constructorChain: string[]
}

export interface ProbeEvent {
  protocolVersion: number
  runId: string
  type:
    | 'HELLO'
    | 'DISCOVER'
    | 'TEST_START'
    | 'TEST_END'
    | 'OBSERVE_CALL'
    | 'MUTATE_CALL'
    | 'TARGET_RETURN'
    | 'TARGET_THROW'
    | 'TARGET_REJECT'
    | 'PROBE_ERROR'
  testId: string | null
  timestamp: string
  callId?: number
  callSiteId?: string | null
  module?: string
  export?: string
  depth?: number
  sequence?: number
  argsFingerprint?: string
  args?: Json[]
  mutated?: boolean
  applied?: boolean
  reason?: string
  mutationId?: string
  value?: Json
  async?: boolean
  error?: SerializedError
  wrapped?: string[]
  unsupported?: string[]
  file?: string
  name?: string
  durationMs?: number
}

export interface EventLog {
  events: ProbeEvent[]
  /** Lignes tronquées ignorées (processus tué au milieu d'une écriture) : `PROBE_TRUNCATED`. */
  truncatedLines: number
  files: string[]
}

/** Relit tous les journaux JSONL `probe-*.jsonl` d'un dossier ; une ligne incomplète est ignorée et comptée. */
export function readEventLog(dir: string): EventLog {
  const files = readdirSync(dir)
    .filter((f) => /^probe-\d+\.jsonl$/.test(f))
    .sort()
  const events: ProbeEvent[] = []
  let truncatedLines = 0
  for (const f of files) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n')
    for (const line of lines) {
      if (line === '') continue
      try {
        events.push(JSON.parse(line) as ProbeEvent)
      } catch {
        truncatedLines++
      }
    }
  }
  return { events, truncatedLines, files }
}
