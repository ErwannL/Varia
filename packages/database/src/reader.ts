import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import type { Db } from './open.js'
import { toResult, toRun, type ResultRecord, type RunRecord } from './records.js'
import * as t from './schema.js'

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
    // `count()` rend toujours une ligne : la somme évite une branche « aucune ligne » impossible.
    return this.db
      .select({ n: count() })
      .from(t.runs)
      .all()
      .reduce((s, r) => s + r.n, 0)
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
