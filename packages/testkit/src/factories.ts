// Fabriques publiques (T-01) : call sites, entrées mutables, mutations et plans, construits avec les
// mêmes fonctions que Varia (sérialisation étiquetée et redaction de la sonde, catalogue du cœur).
import {
  buildCatalog,
  generatePlan,
  mutationId,
  type InputDescriptor,
  type MutationCandidate,
  type ObservedCall,
  type Outcome,
  type Plan,
  type PlannedMutation,
} from '@varia/core'
import { PLUGIN_API_VERSION } from '@varia/plugins'
import type { Json } from '@varia/probe-protocol'
import {
  callSiteIdOf,
  fingerprint,
  serializeArgs,
  testIdOf,
  typeOfSerialized,
} from '@varia/probe-runtime'

/** Champs masqués par défaut (mêmes noms que la configuration par défaut de Varia). */
export const DEFAULT_REDACTED = [
  'password',
  'token',
  'apikey',
  'authorization',
  'cookie',
  'secret',
  'privatekey',
]

export interface CallSiteOptions {
  /** Arguments JavaScript de l'appel : sérialisés et masqués comme le fait la sonde. */
  args: unknown[]
  module?: string
  export?: string
  testFile?: string
  testName?: string
  depth?: number
  sequence?: number
  outcome?: Outcome
  /** Noms de champs masqués (insensibles à la casse) ; défaut : `DEFAULT_REDACTED`. */
  redact?: string[]
}

/** Call site observé (identité, empreinte et arguments comme ceux d'une vraie baseline). */
export function callSite(o: CallSiteOptions): ObservedCall {
  const testId = testIdOf(o.testFile ?? 'tests/demo.test.js', o.testName ?? 'demo', 0)
  const module = o.module ?? 'src/demo.js'
  const exportName = o.export ?? 'demo'
  const depth = o.depth ?? 0
  const sequence = o.sequence ?? 0
  const args = serializeArgs(o.args, {
    redactFields: new Set((o.redact ?? DEFAULT_REDACTED).map((f) => f.toLowerCase())),
  }) as Json[]
  return {
    callId: sequence + 1,
    callSiteId: callSiteIdOf(testId, module, exportName, depth, sequence),
    testId,
    module,
    export: exportName,
    depth,
    sequence,
    argsFingerprint: fingerprint(args),
    args,
    mutated: false,
    outcome: o.outcome ?? { kind: 'return', async: false },
  }
}

/** Entrées (chemins) d'un ou plusieurs call sites, telles que le catalogue de Varia les décrit. */
export function inputsOf(calls: ObservedCall | ObservedCall[]): InputDescriptor[] {
  return buildCatalog(Array.isArray(calls) ? calls : [calls])
}

/** Entrée d'un call site par son chemin (`arg0.email`) ; lève si elle n'existe pas. */
export function inputAt(call: ObservedCall, pathStr: string): InputDescriptor {
  const found = inputsOf(call).find((i) => i.pathStr === pathStr)
  if (found === undefined) throw new Error(`entrée absente : ${pathStr}`)
  return found
}

/** Mutation planifiée d'une entrée (identifiant calculé comme dans un vrai plan). */
export function mutationOf(
  input: InputDescriptor,
  c: Pick<MutationCandidate, 'strategy' | 'value'> & { op?: 'set' | 'delete' },
  test: { file?: string; name?: string } = {},
): PlannedMutation {
  const op = c.op ?? 'set'
  return {
    id: mutationId(input.callSiteId, input.pathStr, c.strategy, op, c.value),
    callSiteId: input.callSiteId,
    testId: input.testId,
    testFile: test.file ?? 'tests/demo.test.js',
    testName: test.name ?? 'demo',
    module: input.module,
    export: input.export,
    depth: input.depth,
    sequence: input.sequence,
    argsFingerprint: input.argsFingerprint,
    path: input.path,
    pathStr: input.pathStr,
    strategy: c.strategy,
    op,
    original: input.original,
    value: c.value,
    originalType: input.type,
    mutatedType: op === 'delete' ? 'undefined' : typeOfSerialized(c.value),
  }
}

export interface PlanForOptions {
  seed?: number
  /** Stratégies intégrées (défaut : aucune, seulement les candidats fournis). */
  strategies?: string[]
  perInput?: number
  /** Candidats externes par entrée (`callSiteId|pathStr`), ex. `generateWith(...).candidates`. */
  extra?: Map<string, MutationCandidate[]>
}

/** Plan généré par le cœur de Varia pour des call sites (déterministe par graine). */
export function planFor(calls: ObservedCall[], o: PlanForOptions = {}): Plan {
  const extra = o.extra ?? new Map<string, MutationCandidate[]>()
  return generatePlan(inputsOf(calls), {
    seed: o.seed ?? 1,
    perInput: o.perInput ?? 100,
    strategies: o.strategies ?? [],
    variaVersion: 'testkit',
    configHash: `plugin-api-${String(PLUGIN_API_VERSION)}`,
    tests: new Map(calls.map((c) => [c.testId, { file: 'tests/demo.test.js', name: 'demo' }])),
    extraCandidates: (i) => extra.get(`${i.callSiteId}|${i.pathStr}`) ?? [],
  })
}
