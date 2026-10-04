import { z } from 'zod'

export const REPORT_SCHEMA_VERSION = 4

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
    /** Capacités déclarées par l'adapter ET vérifiées par `varia doctor` (D-01, v3). */
    capabilities: z.object({
      adapter: z.string(),
      /** Version du lanceur détectée par l'adapter (`info.adapterVersion`) ; `null` : inconnue. */
      adapterVersion: z.string().nullable(),
      declared: z.record(z.string(), z.boolean()),
      /** Statut du test de fumée et raison (code) de tout ce qui n'est pas VERIFIED. */
      verified: z.record(
        z.string(),
        z.object({
          status: z.enum(['VERIFIED', 'NOT_VERIFIED', 'UNSUPPORTED']),
          reason: z.string().nullable(),
        }),
      ),
      /** Date de la vérification `doctor` recopiée dans le run ; `null` : jamais vérifiée. */
      verifiedAt: z.string().nullable(),
    }),
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
        /** Issues précédentes rapprochées (une, ou les candidats d'un `AMBIGUOUS_MATCH`, C-01). */
        matchedFrom: z.array(z.string()),
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
          /** `null` : métrique inconnue (rien à mesurer), jamais 100 % par défaut. */
          lines: z.number().nullable(),
          statements: z.number().nullable(),
          functions: z.number().nullable(),
          branches: z.number().nullable(),
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
        /** Durée du test visé pendant la mutation, rapportée par le runner. */
        testDurationMs: z.number().nullable(),
        /** Drapeaux (`SLOW`, CDC §18.9) : ne changent pas le statut. */
        flags: z.array(z.string()),
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
      /** Cibles déclarées mockées par un fichier de test : jamais observées là (E-03, §10.10). */
      mockedTargets: z.array(z.object({ module: z.string(), testFile: z.string() })),
      skippedMutations: z.array(z.object({ id: z.string(), reason: z.string() })),
      pendingMutations: z.number().int(),
    }),
    limitations: z.array(z.string()),
    /**
     * Extensions externes (J4 X-02, v4) : plugins chargés (ordre de la configuration) et erreurs
     * `PLUGIN_FAILURE` de toutes les commandes du run (chargement, plan, fuzz, rapport).
     */
    plugins: z.object({
      loaded: z.array(
        z.object({
          name: z.string(),
          specifier: z.string(),
          apiVersion: z.number().int(),
          /** Version déclarée par l'extension ; `null` : non déclarée. */
          version: z.string().nullable(),
          extensions: z.array(
            z.object({
              kind: z.enum(['strategy', 'detector', 'rule', 'reporter']),
              id: z.string(),
              /** Désactivée pour le run après une erreur. */
              disabled: z.boolean(),
              fileExtension: z.string().optional(),
            }),
          ),
        }),
      ),
      failures: z.array(
        z.object({
          origin: z.literal('PLUGIN_FAILURE'),
          plugin: z.string(),
          extension: z.string().nullable(),
          phase: z.enum(['load', 'plan', 'fuzz', 'report']),
          code: z.string(),
          message: z.string(),
        }),
      ),
    }),
  })
  .strict()

export type Report = z.infer<typeof reportSchema>

export function reportJsonSchema(): unknown {
  return z.toJSONSchema(reportSchema, { target: 'draft-2020-12' })
}
