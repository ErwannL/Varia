import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCatalog, type InputDescriptor } from './catalog.js'
import {
  compareBaselines,
  observationOf,
  type Observation,
  type StabilityResult,
} from './observe.js'
import { classify, DEFAULT_ORACLE, type Classification, type OracleConfig } from './oracle.js'
import {
  generatePlan,
  serializePlan,
  type Plan,
  type PlanOptions,
  type PlannedMutation,
} from './plan.js'
import { Session, type JestRun, type SessionOptions } from './runner.js'

export interface MutationResult {
  mutation: PlannedMutation
  classification: Classification
  run: JestRun
  observation: Observation
}

/** API du spike J0 : baseline, stabilité, catalogue, plan, exécution isolée d'une mutation. */
export class Spike {
  readonly session: Session
  readonly oracle: OracleConfig
  private planPath: string | null = null

  constructor(opts: SessionOptions & { oracle?: Partial<OracleConfig> }) {
    this.session = new Session(opts)
    this.oracle = { ...DEFAULT_ORACLE, ...opts.oracle }
  }

  async baseline(keepTmp = false): Promise<{ run: JestRun; observation: Observation }> {
    const run = await this.session.runJest({ mode: 'observe', keepTmp })
    return { run, observation: observationOf(run, (f) => this.session.rel(f)) }
  }

  async stability(): Promise<{ first: Observation; second: Observation; result: StabilityResult }> {
    const first = (await this.baseline()).observation
    const second = (await this.baseline()).observation
    return { first, second, result: compareBaselines(first, second) }
  }

  catalog(observation: Observation, skip: string[] = []): InputDescriptor[] {
    const passing = new Set(
      observation.tests.filter((t) => t.status === 'passed').map((t) => t.testId),
    )
    return buildCatalog(
      observation.calls.filter((c) => passing.has(c.testId)),
      skip,
    )
  }

  plan(observation: Observation, o: Omit<PlanOptions, 'tests'> & { skip?: string[] }): Plan {
    const tests = new Map(observation.tests.map((t) => [t.testId, { file: t.file, name: t.name }]))
    return generatePlan(this.catalog(observation, o.skip), { ...o, tests })
  }

  savePlan(plan: Plan): string {
    mkdirSync(this.session.tmpDir, { recursive: true })
    this.planPath = join(this.session.tmpDir, 'plan.json')
    writeFileSync(this.planPath, serializePlan(plan))
    return this.planPath
  }

  /** Une mutation = un processus Jest, limité au test visé (CDC §16.1, §10.9). */
  async execute(plan: Plan, mutation: PlannedMutation, keepTmp = false): Promise<MutationResult> {
    const planPath = this.planPath ?? this.savePlan(plan)
    const run = await this.session.runJest({
      mode: 'fuzz',
      testFile: mutation.testFile,
      testName: mutation.testName,
      planPath,
      mutationId: mutation.id,
      keepTmp,
    })
    const observation = observationOf(run, (f) => this.session.rel(f))
    const mutateEvents = observation.mutateEvents.filter((e) => e.mutationId === mutation.id)
    const mutatedCall = observation.calls.find(
      (c) => c.mutated && c.callSiteId === mutation.callSiteId,
    )
    const testStatus = observation.tests.find((t) => t.testId === mutation.testId)?.status ?? null
    const classification = classify(
      {
        mutation,
        process: run.process,
        hello: run.log.events.some((e) => e.type === 'HELLO'),
        reportPresent: run.report !== null,
        testStatus,
        mutateEvents,
        mutatedCall,
      },
      this.oracle,
    )
    return { mutation, classification, run, observation }
  }

  dispose(): void {
    this.session.dispose()
  }
}
