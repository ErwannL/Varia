/** Origines d'erreur de Varia (CDC §44) et codes de sortie (§27). */
export type FailureKind =
  | 'PROJECT_FAILURE'
  | 'PROBE_FAILURE'
  | 'RUNNER_FAILURE'
  | 'INFRA_FAILURE'
  | 'CONFIG_FAILURE'
  | 'VARIA_INTERNAL_FAILURE'
  | 'PROJECT_MUTATED'
  | 'BASELINE_FAILED'
  | 'UNSUPPORTED_PROBE'

export const EXIT = {
  OK: 0,
  RESILIENCE: 1,
  BASELINE: 2,
  CONFIG: 3,
  INFRA: 4,
  UNSUPPORTED: 5,
  INTERRUPTED: 130,
} as const

const EXIT_OF: Record<FailureKind, number> = {
  PROJECT_FAILURE: EXIT.BASELINE,
  BASELINE_FAILED: EXIT.BASELINE,
  PROBE_FAILURE: EXIT.UNSUPPORTED,
  UNSUPPORTED_PROBE: EXIT.UNSUPPORTED,
  RUNNER_FAILURE: EXIT.INFRA,
  INFRA_FAILURE: EXIT.INFRA,
  CONFIG_FAILURE: EXIT.CONFIG,
  VARIA_INTERNAL_FAILURE: EXIT.INFRA,
  PROJECT_MUTATED: EXIT.INFRA,
}

/** Erreur de Varia : jamais comptée comme résilience du projet. */
export class VariaError extends Error {
  readonly kind: FailureKind
  readonly details: string[]
  constructor(kind: FailureKind, message: string, details: string[] = []) {
    super(message)
    this.name = 'VariaError'
    this.kind = kind
    this.details = details
  }
  get exitCode(): number {
    return EXIT_OF[this.kind]
  }
}
