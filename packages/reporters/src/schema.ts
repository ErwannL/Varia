import { z } from 'zod'

export const REPORT_SCHEMA_VERSION = 2

const counts = z.object({
  mutations: z.number().int(),
  handled: z.number().int(),
  expected: z.number().int(),
  passed: z.number().int(),
  suspicious: z.number().int(),
  unexpected: z.number().int(),
  crashes: z.number().int(),
  timeouts: z.number().int(),
  skipped: z.number().int(),
  infra: z.number().int(),
  pending: z.number().int(),
})

/** Rapport JSON versionné (CDC §31, B « JSON versionné (schemaVersion) »). */
export const reportSchema = z
  .object({
    schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
    varia: z.object({ name: z.literal('varia'), version: z.string() }),
    project: z.object({ id: z.string(), name: z.string(), root: z.string() }),
    run: z.object({
      id: z.string(),
      state: z.string(),
      partial: z.boolean(),
      mode: z.string(),
      seed: z.number().int().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
    reproducibility: z.object({
      seed: z.number().int().nullable(),
      configHash: z.string(),
      envHash: z.string(),
      variaVersion: z.string(),
      gitCommit: z.string().nullable(),
      gitBranch: z.string().nullable(),
    }),
    config: z.string().nullable(),
    baseline: z.object({
      tests: z.number().int(),
      passed: z.number().int(),
      failing: z.array(z.string()),
      flaky: z.array(
        z.object({ testId: z.string(), name: z.string(), reasons: z.array(z.string()) }),
      ),
      calls: z.number().int(),
    }),
    capabilities: z.object({ adapter: z.string(), declared: z.record(z.string(), z.boolean()) }),
    plan: z
      .object({
        possible: z.number().int(),
        planned: z.number().int(),
        sampled: z.boolean(),
        estimateMs: z.number(),
      })
      .nullable(),
    counts,
    resilienceRate: z.number().nullable(),
    coverage: z.object({
      targets: z.object({
        discovered: z.number().int(),
        observed: z.number().int(),
        mutated: z.number().int(),
        neverCalled: z.number().int(),
        transitiveOnly: z.number().int(),
        unsupported: z.number().int(),
      }),
      inputs: z.object({
        mutable: z.number().int(),
        mutated: z.number().int(),
        nonMutable: z.number().int(),
      }),
    }),
    issues: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']),
        state: z.string(),
        target: z.string(),
        title: z.string(),
        errorName: z.string().nullable(),
        message: z.string().nullable(),
        frame: z.string().nullable(),
        count: z.number().int(),
        mutationIds: z.array(z.string()),
        replay: z.string(),
        /** Profondeur minimale des mutations de l'issue (0 : appel direct du test). */
        depth: z.number().int().min(0),
        /** Toutes ses mutations portent sur des appels transitifs (CDC §10.11) : valeur peut-être
         * impossible en production ; hors `ci.fail_on` sauf `ci.include_transitive`. */
        transitive: z.boolean(),
      }),
    ),
    /** Issues connues absentes de ce run : FIXED (cible rejouée) ou UNKNOWN (non rejouée). */
    resolvedIssues: z.array(
      z.object({ id: z.string(), state: z.string(), target: z.string(), title: z.string() }),
    ),
    comparedTo: z.string().nullable(),
    baselineCoverage: z.object({
      status: z.enum(['DISABLED', 'COLLECTED', 'UNAVAILABLE']),
      files: z.array(
        z.object({
          file: z.string(),
          lines: z.number(),
          statements: z.number(),
          functions: z.number(),
          branches: z.number(),
        }),
      ),
    }),
    cache: z
      .object({ hits: z.number().int(), misses: z.number().int(), contentHash: z.string() })
      .nullable(),
    incremental: z
      .object({ base: z.string(), changedFiles: z.array(z.string()).nullable(), scope: z.string() })
      .nullable(),
    acceptances: z.array(
      z.object({
        id: z.string(),
        source: z.string(),
        function: z.string(),
        path: z.string().optional(),
        strategy: z.string().optional(),
        reason: z.string(),
        owner: z.string().optional(),
        expires: z.string().optional(),
        status: z.enum(['ACTIVE', 'EXPIRED', 'OBSOLETE']),
        matched: z.number().int(),
      }),
    ),
    mutations: z.array(
      z.object({
        id: z.string(),
        target: z.string(),
        test: z.string(),
        path: z.string(),
        strategy: z.string(),
        /** Profondeur d'appel du call site muté (0 : appel direct du test, CDC §10.11). */
        depth: z.number().int().min(0),
        /** Stratégie `boundary` : provenance de la borne (declared / observed / universal, §12.3). */
        provenance: z.enum(['declared', 'observed', 'universal']).nullable(),
        original: z.unknown(),
        value: z.unknown(),
        deleted: z.boolean(),
        status: z.string().nullable(),
        subtype: z.string().nullable(),
        reason: z.string().nullable(),
        echoPath: z.string().nullable(),
        error: z.object({ name: z.string(), message: z.string() }).nullable(),
        durationMs: z.number().nullable(),
        acceptedBy: z.string().nullable(),
      }),
    ),
    notCovered: z.object({
      neverCalled: z.array(z.string()),
      transitiveOnly: z.array(z.string()),
      unsupported: z.array(z.string()),
      nonMutableInputs: z.array(
        z.object({ target: z.string(), path: z.string(), reason: z.string() }),
      ),
      flakyTests: z.array(z.string()),
      skippedMutations: z.array(z.object({ id: z.string(), reason: z.string() })),
      pendingMutations: z.number().int(),
    }),
    limitations: z.array(z.string()),
  })
  .strict()

export type Report = z.infer<typeof reportSchema>

export function reportJsonSchema(): unknown {
  return z.toJSONSchema(reportSchema, { target: 'draft-2020-12' })
}
