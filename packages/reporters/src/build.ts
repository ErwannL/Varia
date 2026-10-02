import {
  countResults,
  resilienceRate,
  type AdapterCapabilities,
  type Classification,
} from '@varia/core'
import type { Reader } from '@varia/database'
import { REPORT_SCHEMA_VERSION, type Report } from './schema.js'

const MAX_VALUE_CHARS = 200

/** Valeur affichable : les grandes valeurs sont résumées (type + longueur), jamais recopiées. */
export function summarizeValue(v: unknown): unknown {
  const s = JSON.stringify(v) ?? 'undefined'
  if (s.length <= MAX_VALUE_CHARS) return v
  return {
    $t: 'summary',
    type: Array.isArray(v) ? 'array' : typeof v,
    chars: s.length,
    preview: s.slice(0, 80),
  }
}

/** Limites toujours rappelées (CDC §10.0, §34, §47) : Varia dit ce qu'il n'a pas pu observer. */
export function limitationsOf(
  depth: string,
  capabilities?: Partial<AdapterCapabilities>,
): string[] {
  return [
    'INTERNAL_CALLS_NOT_OBSERVED',
    'NON_EXPORTED_FUNCTIONS_NOT_TARGETED',
    'MOCKED_TARGETS_NOT_OBSERVED',
    ...(capabilities?.esm === true ? [] : ['NATIVE_ESM_UNSUPPORTED']),
    'CLASS_METHODS_NOT_TARGETED',
    ...(depth === 'direct' ? ['TRANSITIVE_CALLS_NOT_MUTATED'] : []),
    'NO_DATABASE_OR_FILESYSTEM_RESET',
  ]
}

/** Construit le rapport JSON d'un run à partir de la base (lecture seule). */
export function buildReport(reader: Reader, runId: string): Report {
  const run = reader.getRun(runId)
  if (run === null) throw new Error(`run inconnu : ${runId}`)
  const o = {
    capabilities: (run.info['capabilities'] ?? {}) as AdapterCapabilities,
    adapter: String(run.info['adapter'] ?? ''),
    depth: String(run.info['depth'] ?? 'direct'),
  }
  const tests = reader.tests(runId)
  const mutations = reader.mutations(runId) as Record<string, unknown>[]
  const results = new Map(reader.results(runId).map((r) => [r.mutationId, r]))
  const targets = reader.targets(runId)
  const inputs = reader.inputs(runId)
  const testName = new Map(tests.map((t) => [t.testId, t.name]))
  const classifications: Classification[] = [...results.values()].map((r) => ({
    status: r.status as Classification['status'],
    testStatus: r.testStatus,
    ...(r.subtype !== null ? { subtype: r.subtype as NonNullable<Classification['subtype']> } : {}),
  }))
  const counts = countResults(mutations.length, classifications)
  const key = (m: { module: string; export: string }) => `${m.module}#${m.export}`
  const byStatus = (s: string) => targets.filter((t) => t.status === s).map(key)
  const mutatedTargets = new Set(
    mutations
      .filter((m) => results.has(String(m['id'])))
      .map((m) => `${String(m['module'])}#${String(m['export'])}`),
  )
  const mutatedInputs = new Set(
    mutations
      .filter((m) => results.has(String(m['id'])))
      .map((m) => `${String(m['callSiteId'])}|${String(m['pathStr'])}`),
  )
  const callSites = new Map(reader.callSites(runId).map((c) => [c.callSiteId, c]))
  const depthOf = new Map(mutations.map((m) => [String(m['id']), Number(m['depth'] ?? 0)]))
  const depths = (ids: string[]) => ids.map((id) => depthOf.get(id) ?? 0)
  const info = run.info
  const planInfo = info['plan'] as
    | { possible: number; planned: number; sampled: boolean; estimateMs: number }
    | undefined
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    varia: { name: 'varia', version: run.variaVersion },
    project: {
      id: run.projectId,
      name: String(info['projectName'] ?? run.projectId),
      root: String(info['projectRoot'] ?? ''),
    },
    run: {
      id: run.id,
      state: run.state,
      partial: run.partial || counts.pending > 0,
      mode: run.mode,
      seed: run.seed,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    reproducibility: {
      seed: run.seed,
      configHash: run.configHash,
      envHash: run.envHash,
      variaVersion: run.variaVersion,
      gitCommit: run.gitCommit,
      gitBranch: run.gitBranch,
    },
    config: reader.config(runId),
    baseline: {
      tests: tests.length,
      passed: tests.filter((t) => t.status === 'passed').length,
      failing: tests.filter((t) => t.status === 'failed').map((t) => t.name),
      flaky: tests
        .filter((t) => t.flaky)
        .map((t) => ({ testId: t.testId, name: t.name, reasons: t.flakyReasons })),
      calls: callSites.size,
    },
    capabilities: { adapter: o.adapter, declared: { ...o.capabilities } },
    plan: planInfo ?? null,
    counts,
    resilienceRate: resilienceRate(counts),
    coverage: {
      targets: {
        discovered: targets.length,
        observed: byStatus('OBSERVED').length,
        mutated: mutatedTargets.size,
        neverCalled: byStatus('NEVER_CALLED').length,
        transitiveOnly: byStatus('TRANSITIVE_ONLY').length,
        unsupported: byStatus('UNSUPPORTED').length,
      },
      inputs: {
        mutable: inputs.filter((i) => i.mutable).length,
        mutated: mutatedInputs.size,
        nonMutable: inputs.filter((i) => !i.mutable).length,
      },
    },
    issues: reader
      .issues(runId)
      .filter((i) => i.count > 0)
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        severity: i.severity as Report['issues'][number]['severity'],
        state: i.state,
        target: i.target,
        title: i.title,
        errorName: i.errorName,
        message: i.message,
        frame: i.frame,
        count: i.count,
        mutationIds: i.mutationIds,
        replay: `varia replay ${i.mutationIds[0] ?? ''}`,
        depth: Math.min(...depths(i.mutationIds)),
        transitive: depths(i.mutationIds).every((d) => d > 0),
      }))
      .sort(
        (a, b) =>
          ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].indexOf(a.severity) -
            ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].indexOf(b.severity) ||
          (a.id < b.id ? -1 : 1),
      ),
    resolvedIssues: reader
      .issues(runId)
      .filter((i) => i.count === 0)
      .map((i) => ({ id: i.id, state: i.state, target: i.target, title: i.title }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    comparedTo: typeof info['comparedTo'] === 'string' ? info['comparedTo'] : null,
    baselineCoverage: {
      status: (info['coverage'] ?? 'DISABLED') as Report['baselineCoverage']['status'],
      files: reader.coverage(runId).map((c) => ({
        file: c.file,
        lines: c.lines,
        statements: c.statements,
        functions: c.functions,
        branches: c.branches,
      })),
    },
    cache: (info['cache'] ?? null) as Report['cache'],
    incremental: (info['incremental'] ?? null) as Report['incremental'],
    acceptances: (info['acceptances'] ?? []) as Report['acceptances'],
    mutations: mutations.map((m) => {
      const r = results.get(String(m['id']))
      const err = r?.error as { name?: string; message?: string } | null | undefined
      return {
        id: String(m['id']),
        target: `${String(m['module'])}#${String(m['export'])}`,
        test: testName.get(String(m['testId'])) ?? String(m['testName'] ?? ''),
        path: String(m['pathStr']),
        strategy: String(m['strategy']),
        depth: Number(m['depth'] ?? 0),
        provenance: (m['provenance'] ?? null) as Report['mutations'][number]['provenance'],
        original: summarizeValue(m['original']),
        value: summarizeValue(m['value']),
        deleted: m['op'] === 'delete',
        status: r?.status ?? null,
        subtype: r?.subtype ?? null,
        reason: r?.reason ?? null,
        echoPath: r?.echoPath ?? null,
        error: err ? { name: String(err.name ?? ''), message: String(err.message ?? '') } : null,
        durationMs: r?.durationMs ?? null,
        testDurationMs: r?.testDurationMs ?? null,
        flags: r?.flags ?? [],
        acceptedBy:
          ((info['acceptedMutations'] ?? {}) as Record<string, string>)[String(m['id'])] ?? null,
      }
    }),
    notCovered: {
      neverCalled: byStatus('NEVER_CALLED'),
      transitiveOnly: byStatus('TRANSITIVE_ONLY'),
      unsupported: byStatus('UNSUPPORTED'),
      nonMutableInputs: inputs
        .filter((i) => !i.mutable)
        .map((i) => {
          const c = callSites.get(i.callSiteId)
          return {
            target: c ? `${c.module}#${c.export}` : i.callSiteId,
            path: i.path,
            reason: i.reason ?? '',
          }
        }),
      flakyTests: tests.filter((t) => t.flaky).map((t) => t.name),
      skippedMutations: [...results.values()]
        .filter((r) => r.status === 'SKIPPED')
        .map((r) => ({ id: r.mutationId, reason: r.reason ?? '' })),
      pendingMutations: counts.pending,
    },
    limitations: limitationsOf(o.depth, o.capabilities),
  }
}
