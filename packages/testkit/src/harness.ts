// Harnais d'exécution d'une mutation (T-01) : applique une mutation planifiée aux arguments d'un call
// site, appelle la cible DANS le processus de test, puis classe le résultat avec l'oracle de Varia et,
// en option, les règles d'oracle d'extensions — mêmes fonctions que le moteur.
import {
  classify,
  DEFAULT_ORACLE,
  observationOf,
  type Classification,
  type ObservedCall,
  type OracleConfig,
  type PlannedMutation,
} from '@varia/core'
import {
  loadPlugins,
  ruleInputOf,
  withVerdict,
  type OracleRuleInput,
  type PluginFailure,
} from '@varia/plugins'
import type { Json, ProbeEvent } from '@varia/probe-protocol'
import { deserialize, serialize } from '@varia/probe-runtime'
import { adapterRun, probe, serializedError } from './probe.js'

const UNDEF: Json = { $t: 'undefined' }

/** Conteneur modifiable d'un nœud sérialisé (objet simple, objet étiqueté `$t: object`, tableau). */
function fields(node: Json): Record<string, Json> | Json[] {
  if (Array.isArray(node)) return node
  const o = node as Record<string, Json>
  return o['$t'] === 'object' ? (o['v'] as Record<string, Json>) : o
}

/** Arguments sérialisés avec la mutation appliquée (copie ; l'original n'est jamais modifié). */
export function applyMutation(args: Json[], m: Pick<PlannedMutation, 'path' | 'op' | 'value'>) {
  const out = structuredClone(args)
  const [first, ...rest] = m.path
  if (rest.length === 0) {
    out[Number(first)] = m.op === 'delete' ? UNDEF : m.value
    return out
  }
  let node = out[Number(first)] as Json
  for (const seg of rest.slice(0, -1)) node = (fields(node) as Record<string, Json>)[seg] as Json
  const container = fields(node) as Record<string, Json>
  const last = rest[rest.length - 1] as string
  if (m.op === 'set') container[last] = m.value
  else if (Array.isArray(container)) container[Number(last)] = { $t: 'hole' }
  else Reflect.deleteProperty(container, last)
  return out
}

export interface RunMutationOptions {
  /** Fonction cible (synchrone ou asynchrone). */
  target: (...args: never[]) => unknown
  /** Call site d'origine (`callSite({ args })`). */
  call: ObservedCall
  mutation: PlannedMutation
  /** Configuration de l'oracle intégré (défaut : celle de Varia). */
  oracle?: OracleConfig
  /** Extensions dont les règles d'oracle s'appliquent (chemins, relatifs à `baseDir`). */
  plugins?: string[]
  baseDir?: string
  timeoutMs?: number
}

export interface MutationRunResult {
  classification: Classification
  /** Messages de sonde équivalents à cette exécution (double de sonde). */
  events: ProbeEvent[]
  pluginFailures: PluginFailure[]
}

/** Exécute UNE mutation et la classe (oracle intégré, puis règles d'extensions). */
export async function runMutation(o: RunMutationOptions): Promise<MutationRunResult> {
  const mutated = applyMutation(o.call.args ?? [], o.mutation)
  const c = { ...o.call, mutated: true, args: mutated }
  const events: ProbeEvent[] = [
    probe.hello(),
    probe.observeCall(c),
    probe.mutateCall(c, o.mutation.id),
  ]
  let failed = false
  try {
    const value = await Promise.resolve(o.target(...(mutated.map(deserialize) as never[])))
    events.push(probe.targetReturn(c, serialize(value) as Json))
  } catch (e) {
    failed = true
    const err = serializedError(e instanceof Error ? e : new Error(String(e)))
    events.push(probe.targetThrow(c, err))
  }
  const run = adapterRun({
    events,
    tests: [
      {
        testId: c.testId,
        file: o.mutation.testFile,
        name: o.mutation.testName,
        status: failed ? 'failed' : 'passed',
        durationMs: 1,
      },
    ],
  })
  const observed = observationOf(run)
  const call = observed.calls[0] as ObservedCall
  const builtIn = classify(
    {
      mutation: o.mutation,
      process: run.process,
      hello: true,
      reportPresent: true,
      testStatus: failed ? 'failed' : 'passed',
      mutateEvents: observed.mutateEvents,
      mutatedCall: call,
    },
    o.oracle ?? DEFAULT_ORACLE,
  )
  const session = loadPlugins({
    specifiers: o.plugins ?? [],
    baseDir: o.baseDir ?? process.cwd(),
    root: o.baseDir ?? process.cwd(),
    timeoutMs: o.timeoutMs ?? 5000,
  })
  try {
    // Mutation appliquée et issue observée : toujours un comportement de la cible (entrée non nulle).
    const verdict = session.applyRules(ruleInputOf(o.mutation, builtIn, call) as OracleRuleInput)
    const classification = verdict === null ? builtIn : withVerdict(builtIn, verdict)
    return { classification, events, pluginFailures: session.failures }
  } finally {
    session.close()
  }
}
