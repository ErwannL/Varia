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
  | 'SLOW'

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
  /** Empreinte secondaire (CDC §20.2) ; `null` quand l'issue n'a pas de pile exploitable. */
  secondary?: SecondaryFingerprint | null
}

/**
 * Empreinte secondaire (CDC §20.2), pour rapprocher une issue dont l'empreinte primaire a changé
 * (refactorisation) : module de la target, fichiers des cadres de pile du projet (similarité), hash
 * de la ligne de code du premier cadre (`null` si la source est illisible).
 */
export interface SecondaryFingerprint {
  module: string
  stackFiles: string[]
  codeHash: string | null
}

/** Lit la ligne `line` (1-based) du fichier relatif `file` du projet ; `null` si illisible. */
export type SourceLine = (file: string, line: number) => string | null

/** Remplace les littéraux par des marqueurs de type (CDC §20.1). */
export function normalizeMessage(message: string): string {
  return message
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '<str>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<num>')
    .replace(/-?\b\d+(?:\.\d+)?\b/g, '<num>')
    .trim()
}

export interface ProjectFrame {
  fn: string
  file: string
  line: number
}

/** Cadres de pile dans le projet (hors `node_modules`/`node:`), chemins relatifs, colonnes ignorées. */
export function projectFrames(stack: string, root: string): ProjectFrame[] {
  const rootSlash = root.replace(/\\/g, '/').replace(/\/?$/, '/')
  const frames: ProjectFrame[] = []
  for (const raw of stack.split('\n')) {
    const line = raw.trim().replace(/\\/g, '/')
    if (!line.startsWith('at ') || line.includes('node_modules') || line.includes('node:')) continue
    const m = /^at (?:(.+?) \()?(.+?):(\d+):\d+\)?$/.exec(line)
    if (!m) continue
    // Groupes 2 et 3 obligatoires dans le motif : toujours présents quand `m` l'est.
    const path = m[2] as string
    const file = path.startsWith(rootSlash) ? path.slice(rootSlash.length) : path
    frames.push({ fn: m[1] ?? '<anonymous>', file, line: Number(m[3]) })
  }
  return frames
}

/** Premier cadre de pile dans le projet, chemin relatif, colonne ignorée (CDC §20.1). */
export function firstProjectFrame(stack: string, root: string): string | null {
  const f = projectFrames(stack, root)[0]
  return f === undefined ? null : `${f.fn} (${f.file}:${String(f.line)})`
}

/** Empreinte secondaire d'une erreur (CDC §20.2) ; `null` sans cadre de pile dans le projet. */
export function secondaryOf(
  module: string,
  stack: string,
  root: string,
  source: SourceLine,
): SecondaryFingerprint | null {
  const frames = projectFrames(stack, root)
  const first = frames[0]
  if (first === undefined) return null
  const code = source(first.file, first.line)
  const snippet = code === null ? '' : code.replace(/\s+/g, ' ').trim()
  return {
    module,
    stackFiles: [...new Set(frames.map((f) => f.file))].sort(),
    codeHash: snippet === '' ? null : sha256(snippet).slice(0, 16),
  }
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
    case 'SLOW':
      return 'LOW'
    default:
      return 'MEDIUM'
  }
}

export interface ResultForIssues {
  mutation: PlannedMutation
  classification: Classification
}

/** Une mutation produit-elle une issue ? Laquelle ? (`null` : comportement sain ou neutre.) */
export function issueOf(
  r: ResultForIssues,
  root: string,
  source: SourceLine = () => null,
): Omit<IssueDraft, 'mutationIds'> | null {
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
      secondary: secondaryOf(r.mutation.module, c.error.stack, root, source),
    })
  }
  return null
}

/** Issue de lenteur (drapeau `SLOW`, CDC §18.9), une par target, gravité LOW. */
export function slowIssueOf(r: ResultForIssues): Omit<IssueDraft, 'mutationIds'> | null {
  if (!(r.classification.flags ?? []).includes('SLOW')) return null
  const target = `${r.mutation.module}#${r.mutation.export}`
  return {
    fingerprint: 'i_' + sha256(['SLOW', target].join('\u0000')).slice(0, 16),
    kind: 'SLOW',
    severity: severityOf('SLOW'),
    target,
    title: `${target} : lenteur`,
    errorName: null,
    frame: null,
    message: null,
  }
}

/** Regroupe les mutations par empreinte primaire (CDC §20.1). Ordre stable. */
export function groupIssues(
  results: ResultForIssues[],
  root: string,
  source: SourceLine = () => null,
): IssueDraft[] {
  const map = new Map<string, IssueDraft>()
  for (const r of results) {
    for (const i of [issueOf(r, root, source), slowIssueOf(r)]) {
      if (i === null) continue
      const existing = map.get(i.fingerprint)
      if (existing) existing.mutationIds.push(r.mutation.id)
      else map.set(i.fingerprint, { ...i, mutationIds: [r.mutation.id] })
    }
  }
  const order: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
  return [...map.values()].sort(
    (a, b) =>
      order.indexOf(a.severity) - order.indexOf(b.severity) ||
      (a.fingerprint < b.fingerprint ? -1 : 1),
  )
}
