import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import type { Db } from './open.js'
import * as t from './schema.js'

const J = JSON.stringify
const now = () => new Date().toISOString()

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

const toResult = (r: typeof t.mutationResults.$inferSelect): ResultRecord => ({
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

const toRun = (r: typeof t.runs.$inferSelect): RunRecord => ({
  ...r,
  partial: r.partial === 1,
  info: JSON.parse(r.info) as Record<string, unknown>,
})

/** Écrivaine unique de la base (CDC §10.6, principe 14) : seul l'orchestrateur l'instancie. */
export class Writer {
  constructor(private readonly db: Db) {}

  upsertProject(p: { id: string; name: string; root: string; framework: string }): void {
    this.db
      .insert(t.projects)
      .values(p)
      .onConflictDoUpdate({
        target: t.projects.id,
        set: { name: p.name, root: p.root, framework: p.framework },
      })
      .run()
  }

  createRun(r: Omit<RunRecord, 'createdAt' | 'updatedAt'>): void {
    const ts = now()
    this.db
      .insert(t.runs)
      .values({ ...r, partial: r.partial ? 1 : 0, info: J(r.info), createdAt: ts, updatedAt: ts })
      .run()
  }

  updateRun(
    id: string,
    patch: Partial<Pick<RunRecord, 'state' | 'partial' | 'info' | 'planPath' | 'seed'>>,
  ): void {
    const set: Partial<typeof t.runs.$inferInsert> = { updatedAt: now() }
    if (patch.state !== undefined) set.state = patch.state
    if (patch.partial !== undefined) set.partial = patch.partial ? 1 : 0
    if (patch.info !== undefined) set.info = J(patch.info)
    if (patch.planPath !== undefined) set.planPath = patch.planPath
    if (patch.seed !== undefined) set.seed = patch.seed
    this.db.update(t.runs).set(set).where(eq(t.runs.id, id)).run()
  }

  saveConfig(runId: string, config: string): void {
    this.db.insert(t.configSnapshots).values({ runId, config }).onConflictDoNothing().run()
  }

  saveTests(
    runId: string,
    rows: {
      testId: string
      file: string
      name: string
      status: string
      flakyReasons: string[]
      durationMs?: number | null
    }[],
  ): void {
    this.db.transaction((tx) => {
      for (const r of rows) {
        tx.insert(t.tests)
          .values({
            runId,
            testId: r.testId,
            file: r.file,
            name: r.name,
            status: r.status,
            flaky: r.flakyReasons.length > 0 ? 1 : 0,
            flakyReasons: J(r.flakyReasons),
            durationMs: r.durationMs ?? null,
          })
          .onConflictDoNothing()
          .run()
      }
    })
  }

  saveCallSites(
    runId: string,
    rows: {
      callSiteId: string
      testId: string
      module: string
      export: string
      depth: number
      sequence: number
      argsFingerprint: string
      args: unknown
      outcome: unknown
      nonDeterministic: boolean
    }[],
  ): void {
    this.db.transaction((tx) => {
      for (const r of rows) {
        tx.insert(t.callSites)
          .values({
            ...r,
            runId,
            args: r.args === null ? null : J(r.args),
            outcome: J(r.outcome),
            nonDeterministic: r.nonDeterministic ? 1 : 0,
          })
          .onConflictDoNothing()
          .run()
      }
    })
  }

  saveInputs(
    runId: string,
    rows: {
      callSiteId: string
      path: string
      type: string
      format: string | null
      bounds: unknown
      mutable: boolean
      reason: string | null
    }[],
  ): void {
    this.db.transaction((tx) => {
      for (const r of rows) {
        tx.insert(t.inputs)
          .values({
            ...r,
            runId,
            bounds: r.bounds === null ? null : J(r.bounds),
            mutable: r.mutable ? 1 : 0,
          })
          .onConflictDoNothing()
          .run()
      }
    })
  }

  saveTargets(runId: string, rows: { module: string; export: string; status: string }[]): void {
    this.db.transaction((tx) => {
      for (const r of rows)
        tx.insert(t.targets)
          .values({ ...r, runId })
          .onConflictDoNothing()
          .run()
    })
  }

  saveMutations(
    runId: string,
    rows: {
      id: string
      callSiteId: string
      testId: string
      module: string
      export: string
      pathStr: string
      strategy: string
    }[],
  ): void {
    this.db.transaction((tx) => {
      for (const m of rows) {
        tx.insert(t.mutations)
          .values({
            runId,
            id: m.id,
            callSiteId: m.callSiteId,
            testId: m.testId,
            target: `${m.module}#${m.export}`,
            path: m.pathStr,
            strategy: m.strategy,
            data: J(m),
          })
          .onConflictDoNothing()
          .run()
      }
    })
  }

  /** Remplace le plan d'un run (import `--plan`) : mutations, résultats et issues du run sont retirés. */
  clearPlan(runId: string): void {
    this.db.transaction((tx) => {
      tx.delete(t.issueOccurrences).where(eq(t.issueOccurrences.runId, runId)).run()
      tx.delete(t.mutationResults).where(eq(t.mutationResults.runId, runId)).run()
      tx.delete(t.mutations).where(eq(t.mutations.runId, runId)).run()
    })
  }

  /** Persiste un résultat dès son ingestion ; idempotent (dédoublonné par identifiant stable, §16.6). */
  saveResult(runId: string, r: ResultRecord): boolean {
    const res = this.db
      .insert(t.mutationResults)
      .values({
        ...r,
        runId,
        timedOut: r.timedOut ? 1 : 0,
        error: r.error === undefined || r.error === null ? null : J(r.error),
        flags: J(r.flags ?? []),
        testDurationMs: r.testDurationMs ?? null,
        createdAt: now(),
      })
      .onConflictDoNothing()
      .run()
    return res.changes === 1
  }

  /** Issues du run : `NEW` si l'empreinte n'a jamais été vue dans ce projet, sinon `UNCHANGED`. */
  saveIssues(runId: string, projectId: string, drafts: IssueDraftRecord[]): void {
    this.db.transaction((tx) => {
      for (const d of drafts) {
        const existing = tx
          .select({ id: t.issues.id })
          .from(t.issues)
          .where(eq(t.issues.id, d.fingerprint))
          .get()
        if (!existing) {
          tx.insert(t.issues)
            .values({
              id: d.fingerprint,
              projectId,
              kind: d.kind,
              severity: d.severity,
              target: d.target,
              title: d.title,
              errorName: d.errorName,
              frame: d.frame,
              message: d.message,
              firstSeenRun: runId,
            })
            .run()
        }
        const state = d.state ?? (existing ? 'UNCHANGED' : 'NEW')
        tx.insert(t.issueOccurrences)
          .values({
            runId,
            issueId: d.fingerprint,
            state,
            count: d.mutationIds.length,
            mutationIds: J(d.mutationIds),
          })
          .onConflictDoUpdate({
            target: [t.issueOccurrences.runId, t.issueOccurrences.issueId],
            set: { state, count: d.mutationIds.length, mutationIds: J(d.mutationIds) },
          })
          .run()
      }
    })
  }

  /** Issues connues ABSENTES de ce run : `FIXED` (cible exécutée) ou `UNKNOWN` (non rejouée). */
  saveAbsentIssues(runId: string, rows: { issueId: string; state: string }[]): void {
    this.db.transaction((tx) => {
      for (const r of rows) {
        tx.insert(t.issueOccurrences)
          .values({ runId, issueId: r.issueId, state: r.state, count: 0, mutationIds: '[]' })
          .onConflictDoUpdate({
            target: [t.issueOccurrences.runId, t.issueOccurrences.issueId],
            set: { state: r.state, count: 0, mutationIds: '[]' },
          })
          .run()
      }
    })
  }

  saveCoverage(
    runId: string,
    rows: {
      file: string
      lines: number
      statements: number
      functions: number
      branches: number
    }[],
  ): void {
    this.db.transaction((tx) => {
      for (const r of rows)
        tx.insert(t.coverage)
          .values({ ...r, runId })
          .onConflictDoNothing()
          .run()
    })
  }

  cacheResult(key: string, result: ResultRecord): void {
    this.db
      .insert(t.resultCache)
      .values({ key, result: J(result), createdAt: now() })
      .onConflictDoNothing()
      .run()
  }

  addAcceptance(a: {
    id: string
    projectId: string
    function: string
    path: string | null
    strategy: string | null
    reason: string
    owner: string | null
    expires: string | null
  }): void {
    this.db
      .insert(t.acceptances)
      .values({ ...a, createdAt: now() })
      .run()
  }

  deleteAcceptance(id: string): boolean {
    return this.db.delete(t.acceptances).where(eq(t.acceptances.id, id)).run().changes === 1
  }

  event(runId: string, type: string, data: Record<string, unknown> = {}): void {
    this.db
      .insert(t.events)
      .values({ runId, type, at: now(), data: J(data) })
      .run()
  }
}

/** Requêtes de lecture (orchestrateur, API, rapports). */
export class Reader {
  constructor(private readonly db: Db) {}

  listRuns(limit = 50, offset = 0): RunRecord[] {
    return this.db
      .select()
      .from(t.runs)
      .orderBy(desc(t.runs.createdAt), desc(t.runs.id))
      .limit(limit)
      .offset(offset)
      .all()
      .map(toRun)
  }

  countRuns(): number {
    return this.db.select({ n: count() }).from(t.runs).get()?.n ?? 0
  }

  getRun(id: string): RunRecord | null {
    const r = this.db.select().from(t.runs).where(eq(t.runs.id, id)).get()
    return r ? toRun(r) : null
  }

  latestRun(projectId: string, states?: string[]): RunRecord | null {
    const where = states
      ? and(eq(t.runs.projectId, projectId), inArray(t.runs.state, states))
      : eq(t.runs.projectId, projectId)
    const r = this.db
      .select()
      .from(t.runs)
      .where(where)
      .orderBy(desc(t.runs.createdAt), desc(t.runs.id))
      .get()
    return r ? toRun(r) : null
  }

  config(runId: string): string | null {
    return (
      this.db.select().from(t.configSnapshots).where(eq(t.configSnapshots.runId, runId)).get()
        ?.config ?? null
    )
  }

  tests(runId: string) {
    return this.db
      .select()
      .from(t.tests)
      .where(eq(t.tests.runId, runId))
      .orderBy(asc(t.tests.file), asc(t.tests.name))
      .all()
      .map((r) => ({
        ...r,
        flaky: r.flaky === 1,
        flakyReasons: JSON.parse(r.flakyReasons) as string[],
      }))
  }

  callSites(runId: string) {
    return this.db
      .select()
      .from(t.callSites)
      .where(eq(t.callSites.runId, runId))
      .all()
      .map((r) => ({
        ...r,
        args: r.args === null ? null : (JSON.parse(r.args) as unknown),
        outcome: JSON.parse(r.outcome) as unknown,
        nonDeterministic: r.nonDeterministic === 1,
      }))
  }

  inputs(runId: string) {
    return this.db
      .select()
      .from(t.inputs)
      .where(eq(t.inputs.runId, runId))
      .all()
      .map((r) => ({
        ...r,
        mutable: r.mutable === 1,
        bounds: r.bounds === null ? null : (JSON.parse(r.bounds) as unknown),
      }))
  }

  targets(runId: string) {
    return this.db
      .select()
      .from(t.targets)
      .where(eq(t.targets.runId, runId))
      .orderBy(asc(t.targets.module), asc(t.targets.export))
      .all()
  }

  mutations(runId: string): Record<string, unknown>[] {
    return this.db
      .select()
      .from(t.mutations)
      .where(eq(t.mutations.runId, runId))
      .orderBy(asc(t.mutations.id))
      .all()
      .map((r) => JSON.parse(r.data) as Record<string, unknown>)
  }

  mutation(runId: string, id: string): Record<string, unknown> | null {
    const r = this.db
      .select()
      .from(t.mutations)
      .where(and(eq(t.mutations.runId, runId), eq(t.mutations.id, id)))
      .get()
    return r ? (JSON.parse(r.data) as Record<string, unknown>) : null
  }

  /** Dernier run contenant cette mutation (rejeu par identifiant seul). */
  runOfMutation(id: string): string | null {
    return (
      this.db
        .select({ runId: t.mutations.runId })
        .from(t.mutations)
        .innerJoin(t.runs, eq(t.runs.id, t.mutations.runId))
        .where(eq(t.mutations.id, id))
        .orderBy(desc(t.runs.createdAt))
        .get()?.runId ?? null
    )
  }

  results(runId: string): ResultRecord[] {
    return this.db
      .select()
      .from(t.mutationResults)
      .where(eq(t.mutationResults.runId, runId))
      .orderBy(asc(t.mutationResults.mutationId))
      .all()
      .map(toResult)
  }

  result(runId: string, mutationId: string): ResultRecord | null {
    const r = this.db
      .select()
      .from(t.mutationResults)
      .where(and(eq(t.mutationResults.runId, runId), eq(t.mutationResults.mutationId, mutationId)))
      .get()
    return r === undefined ? null : toResult(r)
  }

  resultIds(runId: string): Set<string> {
    return new Set(
      this.db
        .select({ id: t.mutationResults.mutationId })
        .from(t.mutationResults)
        .where(eq(t.mutationResults.runId, runId))
        .all()
        .map((r) => r.id),
    )
  }

  issues(runId: string) {
    return this.db
      .select()
      .from(t.issueOccurrences)
      .innerJoin(t.issues, eq(t.issues.id, t.issueOccurrences.issueId))
      .where(eq(t.issueOccurrences.runId, runId))
      .all()
      .map((r) => ({
        ...r.issues,
        state: r.issue_occurrences.state,
        count: r.issue_occurrences.count,
        mutationIds: JSON.parse(r.issue_occurrences.mutationIds) as string[],
      }))
  }

  issue(id: string) {
    return this.db.select().from(t.issues).where(eq(t.issues.id, id)).get() ?? null
  }

  issueHistory(id: string) {
    return this.db
      .select()
      .from(t.issueOccurrences)
      .where(eq(t.issueOccurrences.issueId, id))
      .all()
      .map((r) => ({ ...r, mutationIds: JSON.parse(r.mutationIds) as string[] }))
  }

  coverage(runId: string) {
    return this.db
      .select()
      .from(t.coverage)
      .where(eq(t.coverage.runId, runId))
      .orderBy(asc(t.coverage.file))
      .all()
  }

  cachedResult(key: string): ResultRecord | null {
    const r = this.db.select().from(t.resultCache).where(eq(t.resultCache.key, key)).get()
    return r ? (JSON.parse(r.result) as ResultRecord) : null
  }

  acceptances(projectId: string) {
    return this.db
      .select()
      .from(t.acceptances)
      .where(eq(t.acceptances.projectId, projectId))
      .orderBy(asc(t.acceptances.createdAt), asc(t.acceptances.id))
      .all()
  }

  events(runId: string, type?: string) {
    const where = type
      ? and(eq(t.events.runId, runId), eq(t.events.type, type))
      : eq(t.events.runId, runId)
    return this.db
      .select()
      .from(t.events)
      .where(where)
      .orderBy(asc(t.events.id))
      .all()
      .map((r) => ({ ...r, data: JSON.parse(r.data) as Record<string, unknown> }))
  }
}
