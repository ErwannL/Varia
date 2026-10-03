import type { ProbeEvent } from '@varia/probe-protocol'
import type { ProcessResult } from './exec/proc.js'

/** Capacités d'un adapter (CDC §9.2). Déclarées ici ; `varia doctor` les VÉRIFIE sur le projet. */
export interface AdapterCapabilities {
  observation: boolean
  argumentMutation: boolean
  perTestSelection: boolean
  asyncTargets: boolean
  esm: boolean
  cjs: boolean
  mocks: boolean
  testParameters: boolean
  coverage: boolean
  isolatedProcess: boolean
  parallelSafe: boolean
}

export interface DetectResult {
  detected: boolean
  framework: string
  version: string | null
  /** Le projet est en ESM natif (`"type": "module"` sans transform) : la sonde ne peut pas s'y injecter (J1). */
  nativeEsm: boolean
  reasons: string[]
}

export interface PrepareContext {
  root: string
  /** Répertoire de travail des processus de test (`test.cwd`, résolu dans le projet). */
  cwd?: string
  /** Variables d'environnement des processus de test (`test.env`). */
  env?: Record<string, string>
  tmpDir: string
  runId: string
  include: string[]
  exclude: string[]
  redact: { fields: string[]; patterns: string[]; skipPaths: string[]; hmacKey: string }
  nodeOptions?: string
  /** Limite de tas des processus de test (`mutations.limits.memory_mb`, CDC §16.3). */
  memoryMb?: number
}

/** `NODE_OPTIONS` des processus de test : options du projet, puis limite de mémoire (A-03). */
export function testNodeOptions(
  inherited: string | undefined,
  ctx: Pick<PrepareContext, 'nodeOptions' | 'memoryMb'>,
): string | undefined {
  const parts = [
    inherited,
    ctx.nodeOptions,
    ctx.memoryMb !== undefined ? `--max-old-space-size=${String(ctx.memoryMb)}` : undefined,
  ].filter((p): p is string => p !== undefined && p.trim() !== '')
  return parts.length > 0 ? parts.join(' ') : undefined
}

export interface AdapterRunOptions {
  mode: 'observe' | 'fuzz'
  runDir: string
  timeoutMs: number
  testFile?: string
  testName?: string
  planPath?: string
  mutationId?: string
  maxOutputBytes?: number
  /** Collecter la couverture (baseline seulement, CDC §23). */
  coverage?: boolean
  /** Variables propres à CETTE exécution (ex. répertoire jetable `reset.filesystem: tmpdir`). */
  env?: Record<string, string>
}

export interface TestResult {
  testId: string
  file: string
  name: string
  status: 'passed' | 'failed' | 'skipped' | 'other'
  durationMs: number | null
}

export interface AdapterRun {
  process: ProcessResult
  /** `null` si le runner n'a produit aucun résultat exploitable (processus mort, crash). */
  tests: TestResult[] | null
  events: ProbeEvent[]
  truncatedLines: number
  invalidLines: number
  /** Couverture par fichier relatif (pourcentages), si demandée et produite par le runner. */
  coverage?: CoverageRow[]
}

/** Pourcentages de couverture ; `null` = inconnu (istanbul « Unknown », métrique absente). */
export interface CoverageRow {
  file: string
  lines: number | null
  statements: number | null
  functions: number | null
  branches: number | null
}

/** Lit un `coverage-summary.json` (format istanbul, commun à Jest et Vitest). */
export function parseCoverageSummary(
  json: string,
  root: string,
  rel: (abs: string) => string,
): CoverageRow[] {
  const data = JSON.parse(json) as Record<string, Record<string, { pct: number | string }>>
  void root
  return Object.entries(data)
    .filter(([k]) => k !== 'total')
    .map(([file, m]) => {
      // Valeur non numérique (« Unknown » : rien à mesurer) ⇒ inconnu, jamais 100 % (B-07).
      const pct = (k: string) => {
        const v = m[k]?.pct
        return typeof v === 'number' ? v : null
      }
      return {
        file: rel(file),
        lines: pct('lines'),
        statements: pct('statements'),
        functions: pct('functions'),
        branches: pct('branches'),
      }
    })
    .sort((a, b) => (a.file < b.file ? -1 : 1))
}

/**
 * Interface d'adapter (CDC §9.2, simplifiée en J1 : `discover` et `parseResult` sont internes à `run`).
 * Le cœur ne connaît aucun runner : tout ce qui est propre à Jest vit dans `packages/adapters/jest`.
 */
export interface TestAdapter {
  id: string
  detect(root: string): Promise<DetectResult>
  capabilities(): AdapterCapabilities
  prepare(ctx: PrepareContext): Promise<void>
  run(o: AdapterRunOptions): Promise<AdapterRun>
}
