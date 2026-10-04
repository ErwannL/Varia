// Formes renvoyées par l'API locale (sous-ensemble utilisé par le dashboard).
export interface Run {
  id: string
  state: string
  mode: string
  seed: number | null
  partial: boolean
  createdAt: string
}
export interface Counts {
  mutations: number
  handled: number
  expected: number
  passed: number
  suspicious: number
  unexpected: number
  crashes: number
  timeouts: number
  skipped: number
  infra: number
  pending: number
}
export interface Summary {
  run: Run
  counts: Counts
  resilienceRate: number | null
  coverage: {
    targets: { discovered: number; mutated: number }
    inputs: { mutable: number; mutated: number }
  }
  issues: number
  critical: number
  pluginFailures: number
}
export interface Issue {
  id: string
  kind: string
  severity: string
  state: string
  target: string
  title: string
  errorName: string | null
  message: string | null
  frame: string | null
  count: number
  mutationIds: string[]
}
export interface MutationRow {
  id: string
  target: string
  test: string
  path: string
  strategy: string
  original: unknown
  value: unknown
  deleted: boolean
  status: string | null
  subtype: string | null
  reason: string | null
  error: { name: string; message: string } | null
}
export interface Page<T> {
  total: number
  limit: number
  offset: number
  items: T[]
}
export interface NotCovered {
  sections: {
    neverCalled: Page<string>
    transitiveOnly: Page<string>
    unsupported: Page<string>
    nonMutableInputs: Page<{ target: string; path: string; reason: string }>
    flakyTests: Page<string>
    mockedTargets: Page<{ module: string; testFile: string }>
    skippedMutations: Page<{ id: string; reason: string }>
  }
  pendingMutations: number
  limitations: string[]
}
