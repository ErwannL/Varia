import type { Reader } from '@varia/database'
import { buildReport, type Report } from '@varia/reporters'

/**
 * États terminaux : un run dans l'un d'eux n'évolue plus (immuable), ses agrégats sont donc
 * mémoïsés. Un run en cours est recalculé à chaque requête (jamais de donnée périmée).
 */
export const TERMINAL_STATES = new Set([
  'COMPLETED',
  'FAILED',
  'ABORTED',
  'INFRA_ERROR',
  'BASELINE_FAILED',
  'RESET_FAILED',
])

export interface NodeCounts {
  mutations: number
  crashes: number
  timeouts: number
  unexpected: number
}
export type MutationRow = Report['mutations'][number] & {
  callSiteId: string
  testId: string
  file: string
}
export interface TestRow {
  testId: string
  file: string
  folder: string
  name: string
  status: string
  flaky: boolean
  callSites: number
  counts: NodeCounts
}
export interface CallSiteRow {
  callSiteId: string
  testId: string
  target: string
  depth: number
  sequence: number
  nonDeterministic: boolean
  counts: NodeCounts
}
export interface FileRow {
  file: string
  folder: string
  tests: number
  counts: NodeCounts
}
export interface FolderRow {
  folder: string
  files: number
  tests: number
  counts: NodeCounts
}
export interface RunAggregate {
  report: Report
  mutations: MutationRow[]
  tests: TestRow[]
  callSites: CallSiteRow[]
  files: FileRow[]
  folders: FolderRow[]
}

/** Dossier d'un fichier de test (`.` à la racine du projet). */
export const folderOf = (file: string): string => {
  const i = file.lastIndexOf('/')
  return i < 0 ? '.' : file.slice(0, i)
}

const zero = (): NodeCounts => ({ mutations: 0, crashes: 0, timeouts: 0, unexpected: 0 })
const add = (c: NodeCounts, status: string | null): void => {
  c.mutations++
  if (status === 'CRASH') c.crashes++
  if (status === 'TIMEOUT') c.timeouts++
  if (status === 'UNEXPECTED_FAILURE') c.unexpected++
}
const countsIn = (map: Map<string, NodeCounts>, key: string): NodeCounts => {
  const c = map.get(key) ?? zero()
  map.set(key, c)
  return c
}

/** Construit tous les agrégats d'un run en UNE passe sur la base (lecture seule). */
export function buildAggregate(reader: Reader, runId: string): RunAggregate {
  const report = buildReport(reader, runId)
  const raw = new Map(reader.mutations(runId).map((m) => [String(m['id']), m]))
  const byTest = new Map<string, NodeCounts>()
  const bySite = new Map<string, NodeCounts>()
  const byFile = new Map<string, NodeCounts>()
  const byFolder = new Map<string, NodeCounts>()
  const mutations = report.mutations.map((m) => {
    const d = raw.get(m.id) as Record<string, unknown>
    const row: MutationRow = {
      ...m,
      callSiteId: String(d['callSiteId']),
      testId: String(d['testId']),
      file: String(d['testFile']),
    }
    add(countsIn(byTest, row.testId), m.status)
    add(countsIn(bySite, row.callSiteId), m.status)
    add(countsIn(byFile, row.file), m.status)
    add(countsIn(byFolder, folderOf(row.file)), m.status)
    return row
  })
  const sites = reader.callSites(runId)
  const sitesPerTest = new Map<string, number>()
  for (const c of sites) sitesPerTest.set(c.testId, (sitesPerTest.get(c.testId) ?? 0) + 1)
  const tests: TestRow[] = reader.tests(runId).map((t) => ({
    testId: t.testId,
    file: t.file,
    folder: folderOf(t.file),
    name: t.name,
    status: t.status,
    flaky: t.flaky,
    callSites: sitesPerTest.get(t.testId) ?? 0,
    counts: byTest.get(t.testId) ?? zero(),
  }))
  const callSites: CallSiteRow[] = sites
    .map((c) => ({
      callSiteId: c.callSiteId,
      testId: c.testId,
      target: `${c.module}#${c.export}`,
      depth: c.depth,
      sequence: c.sequence,
      nonDeterministic: c.nonDeterministic,
      counts: bySite.get(c.callSiteId) ?? zero(),
    }))
    .sort((a, b) => a.testId.localeCompare(b.testId) || a.sequence - b.sequence)
  const fileTests = new Map<string, number>()
  for (const t of tests) fileTests.set(t.file, (fileTests.get(t.file) ?? 0) + 1)
  const files: FileRow[] = [...fileTests.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, n]) => ({
      file,
      folder: folderOf(file),
      tests: n,
      counts: byFile.get(file) ?? zero(),
    }))
  const folders: FolderRow[] = [...new Set(files.map((f) => f.folder))].sort().map((folder) => {
    const inFolder = files.filter((f) => f.folder === folder)
    return {
      folder,
      files: inFolder.length,
      tests: inFolder.reduce((s, f) => s + f.tests, 0),
      counts: byFolder.get(folder) ?? zero(),
    }
  })
  return { report, mutations, tests, callSites, files, folders }
}

/**
 * Agrégats par run, mémoïsés pour les runs terminés (clé : identifiant, état, date de mise à jour) :
 * l'API ne reconstruit plus un rapport complet à chaque requête (E-07).
 */
export class Aggregates {
  /** Nombre de constructions effectives (observable par les tests de charge). */
  builds = 0
  private readonly cache = new Map<string, { key: string; value: RunAggregate }>()
  constructor(
    private readonly reader: Reader,
    private readonly max = 8,
  ) {}

  get(runId: string): RunAggregate | null {
    const run = this.reader.getRun(runId)
    if (run === null) return null
    const key = `${run.state}|${run.updatedAt}`
    const hit = this.cache.get(runId)
    if (hit?.key === key) return hit.value
    const value = buildAggregate(this.reader, runId)
    this.builds++
    this.cache.delete(runId)
    if (TERMINAL_STATES.has(run.state)) {
      this.cache.set(runId, { key, value })
      if (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value as string)
    }
    return value
  }
}
