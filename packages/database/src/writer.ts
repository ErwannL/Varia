import { desc, eq } from 'drizzle-orm'
import type { Db } from './open.js'
import { J, now, type IssueDraftRecord, type ResultRecord, type RunRecord } from './records.js'
import * as t from './schema.js'

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
        const secondary = {
          module: d.secondary?.module ?? null,
          stackFiles: d.secondary == null ? null : J(d.secondary.stackFiles),
          codeHash: d.secondary?.codeHash ?? null,
        }
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
              ...secondary,
            })
            .run()
        } else if (d.secondary != null) {
          // Dernière empreinte secondaire connue (l'extrait de code peut avoir changé).
          tx.update(t.issues).set(secondary).where(eq(t.issues.id, d.fingerprint)).run()
        }
        const matchedFrom = J(d.matchedFrom ?? [])
        const state = d.state ?? (existing ? 'UNCHANGED' : 'NEW')
        tx.insert(t.issueOccurrences)
          .values({
            runId,
            issueId: d.fingerprint,
            state,
            count: d.mutationIds.length,
            mutationIds: J(d.mutationIds),
            matchedFrom,
          })
          .onConflictDoUpdate({
            target: [t.issueOccurrences.runId, t.issueOccurrences.issueId],
            set: { state, count: d.mutationIds.length, mutationIds: J(d.mutationIds), matchedFrom },
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
      lines: number | null
      statements: number | null
      functions: number | null
      branches: number | null
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

  /**
   * Rétention (CDC §24, B-03) : garde les `keep` runs les plus récents du projet et supprime les autres
   * avec toutes leurs données (tests, call sites, mutations, résultats, occurrences, événements… par
   * cascade des clés étrangères). Les ISSUES (identités, première apparition) et les ACCEPTATIONS sont
   * conservées. Renvoie les identifiants des runs supprimés (plus anciens d'abord).
   */
  prune(projectId: string, keep: number): string[] {
    const runs = this.db
      .select({ id: t.runs.id })
      .from(t.runs)
      .where(eq(t.runs.projectId, projectId))
      .orderBy(desc(t.runs.createdAt), desc(t.runs.id))
      .all()
      .map((r) => r.id)
    const doomed = runs.slice(Math.max(keep, 0)).reverse()
    this.db.transaction((tx) => {
      for (const id of doomed) tx.delete(t.runs).where(eq(t.runs.id, id)).run()
    })
    return doomed
  }
}
