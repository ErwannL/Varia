import { sha256 } from '@varia/probe-runtime'
import type { Classification } from './oracle.js'
import type { PlannedMutation } from './plan.js'

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'
export type IssueKind =
  | 'ERROR'
  | 'UNEXPECTED'
  | 'TIMEOUT'
  | 'PROCESS_EXIT'
  | 'RESOURCE_LIMIT'
  | 'SUSPICIOUS_ACCEPT'
  | 'DEPENDENCY_ERROR'

export interface IssueDraft {
  fingerprint: string
  kind: IssueKind
  severity: Severity
  target: string
  title: string
  errorName: string | null
  frame: string | null
  message: string | null
  mutationIds: string[]
}

/** Remplace les littéraux par des marqueurs de type (CDC §20.1). */
export function normalizeMessage(message: string): string {
  return message
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '<str>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<num>')
    .replace(/-?\b\d+(?:\.\d+)?\b/g, '<num>')
    .trim()
}

/** Premier cadre de pile dans le projet, chemin relatif, colonne ignorée (CDC §20.1). */
export function firstProjectFrame(stack: string, root: string): string | null {
  const rootSlash = root.replace(/\\/g, '/').replace(/\/?$/, '/')
  for (const raw of stack.split('\n')) {
    const line = raw.trim().replace(/\\/g, '/')
    if (!line.startsWith('at ') || line.includes('node_modules') || line.includes('node:')) continue
    const m = /^at (?:(.+?) \()?(.+?):(\d+):\d+\)?$/.exec(line)
    if (!m) continue
    const file = (m[2] ?? '').startsWith(rootSlash)
      ? (m[2] ?? '').slice(rootSlash.length)
      : (m[2] ?? '')
    return `${m[1] ?? '<anonymous>'} (${file}:${m[3] ?? ''})`
  }
  return null
}

/** Gravité par règles explicites (CDC §19) ; ne cache jamais une issue. */
export function severityOf(kind: IssueKind): Severity {
  switch (kind) {
    case 'TIMEOUT':
    case 'PROCESS_EXIT':
    case 'RESOURCE_LIMIT':
      return 'CRITICAL'
    case 'ERROR':
      return 'HIGH'
    default:
      return 'MEDIUM'
  }
}

export interface ResultForIssues {
  mutation: PlannedMutation
  classification: Classification
}

/** Une mutation produit-elle une issue ? Laquelle ? (`null` : comportement sain ou neutre.) */
export function issueOf(r: ResultForIssues, root: string): Omit<IssueDraft, 'mutationIds'> | null {
  const c = r.classification
  const target = `${r.mutation.module}#${r.mutation.export}`
  const make = (
    kind: IssueKind,
    parts: (string | null)[],
    title: string,
    extra: Partial<IssueDraft> = {},
  ) => ({
    fingerprint:
      'i_' + sha256([kind, target, ...parts.map((p) => p ?? '')].join('\u0000')).slice(0, 16),
    kind,
    severity: severityOf(kind),
    target,
    title,
    errorName: null,
    frame: null,
    message: null,
    ...extra,
  })
  if (c.status === 'TIMEOUT') return make('TIMEOUT', [], `${target} : timeout`)
  if (c.status === 'CRASH' && c.subtype === 'RESOURCE_LIMIT')
    return make('RESOURCE_LIMIT', [], `${target} : limite de ressources`)
  if (c.status === 'CRASH' && c.subtype === 'PROCESS_EXIT')
    return make('PROCESS_EXIT', [], `${target} : sortie anormale du processus`)
  if (c.subtype === 'SUSPICIOUS_ACCEPT') {
    return make(
      'SUSPICIOUS_ACCEPT',
      [c.reason ?? '', r.mutation.pathStr],
      `${target} : acceptation suspecte (${c.reason ?? ''}) sur ${r.mutation.pathStr}`,
      // Raison et chemin conservés en champs pour traduire le titre au rendu.
      { errorName: c.reason ?? null, message: r.mutation.pathStr },
    )
  }
  if ((c.status === 'CRASH' || c.status === 'UNEXPECTED_FAILURE') && c.error) {
    const kind: IssueKind =
      c.subtype === 'DEPENDENCY_ERROR'
        ? 'DEPENDENCY_ERROR'
        : c.status === 'CRASH'
          ? 'ERROR'
          : 'UNEXPECTED'
    const frame = firstProjectFrame(c.error.stack, root)
    const message = normalizeMessage(c.error.message)
    return make(kind, [c.error.name, frame, message], `${target} : ${c.error.name} — ${message}`, {
      errorName: c.error.name,
      frame,
      message,
    })
  }
  return null
}

/** Regroupe les mutations par empreinte primaire (CDC §20.1). Ordre stable. */
export function groupIssues(results: ResultForIssues[], root: string): IssueDraft[] {
  const map = new Map<string, IssueDraft>()
  for (const r of results) {
    const i = issueOf(r, root)
    if (i === null) continue
    const existing = map.get(i.fingerprint)
    if (existing) existing.mutationIds.push(r.mutation.id)
    else map.set(i.fingerprint, { ...i, mutationIds: [r.mutation.id] })
  }
  const order: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
  return [...map.values()].sort(
    (a, b) =>
      order.indexOf(a.severity) - order.indexOf(b.severity) ||
      (a.fingerprint < b.fingerprint ? -1 : 1),
  )
}
