// Doubles pour tester le moteur EN PROCESSUS : adapter scripté, projet temporaire, baseline en base.
import type {
  AdapterCapabilities,
  AdapterRun,
  AdapterRunOptions,
  PrepareContext,
  TestAdapter,
} from '@varia/core'
import type { ProbeEvent } from '@varia/probe-protocol'
import { callSiteIdOf, fingerprint, serializeArgs, testIdOf } from '@varia/probe-runtime'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EngineContext } from '../src/index.js'

export const CAPS: AdapterCapabilities = {
  observation: true,
  argumentMutation: true,
  perTestSelection: true,
  asyncTargets: true,
  esm: false,
  cjs: true,
  mocks: false,
  testParameters: true,
  coverage: false,
  isolatedProcess: true,
  parallelSafe: false,
}

export type Script = (o: AdapterRunOptions, ctx: PrepareContext) => AdapterRun | Promise<AdapterRun>

/** Adapter dont chaque `run` est rendu par un script (aucun runner réel). */
export class FakeAdapter implements TestAdapter {
  readonly id = 'fake'
  runs: AdapterRunOptions[] = []
  prepared: PrepareContext[] = []
  constructor(
    private readonly script: Script,
    private readonly detected = { detected: true, nativeEsm: false },
  ) {}
  capabilities(): AdapterCapabilities {
    return { ...CAPS }
  }
  async detect() {
    return { ...this.detected, framework: 'fake', version: '1.0.0', reasons: [] }
  }
  async prepare(ctx: PrepareContext): Promise<void> {
    this.prepared.push(ctx)
  }
  async run(o: AdapterRunOptions): Promise<AdapterRun> {
    this.runs.push(o)
    return this.script(o, this.prepared.at(-1) as PrepareContext)
  }
}

/** Projet temporaire (racine canonique) avec un `varia.yml`. */
export function project(yml = 'version: 1\n'): string {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'varia-eng-')))
  writeFileSync(join(d, 'varia.yml'), yml)
  return d
}

export function context(adapter: TestAdapter, yml?: string, root = project(yml)): EngineContext {
  return new EngineContext({ root, adapter, dataDir: join(root, '.data') })
}

export const proc = (over: Partial<AdapterRun['process']> = {}): AdapterRun['process'] => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  durationMs: 10,
  stdout: '',
  stderr: '',
  outputTruncated: false,
  pid: 1,
  ...over,
})

const ev = (type: string, fields: Partial<ProbeEvent> = {}): ProbeEvent =>
  ({ protocolVersion: 1, runId: 'r', type, testId: null, timestamp: 'T', ...fields }) as ProbeEvent

export interface FakeCall {
  module?: string
  export?: string
  args: unknown[]
  depth?: number
  /** Issue observée : retour (valeur sérialisée) ou erreur. */
  returns?: unknown
  throws?: { name: string; message?: string; chain?: string[] }
}
export interface FakeTest {
  file?: string
  name: string
  status?: 'passed' | 'failed'
  calls: FakeCall[]
}

/**
 * Exécution d'observation simulée : événements de la sonde (HELLO, DISCOVER, OBSERVE_CALL, TARGET_*)
 * et résultats de tests, comme les produirait un vrai runner.
 */
export function observeRun(tests: FakeTest[], over: Partial<AdapterRun> = {}): AdapterRun {
  const events: ProbeEvent[] = [ev('HELLO', { mode: 'observe', pid: 1 })]
  const modules = new Map<string, Set<string>>()
  let callId = 0
  for (const t of tests) {
    const file = t.file ?? 'tests/a.test.js'
    const testId = testIdOf(file, t.name, 0)
    const seq = new Map<string, number>()
    for (const c of t.calls) {
      const module = c.module ?? 'src/a.js'
      const exp = c.export ?? 'f'
      const depth = c.depth ?? 0
      modules.set(module, (modules.get(module) ?? new Set()).add(exp))
      const k = `${module}#${exp}#${depth}`
      const sequence = seq.get(k) ?? 0
      seq.set(k, sequence + 1)
      const args = serializeArgs(c.args)
      callId++
      events.push(
        ev('OBSERVE_CALL', {
          testId,
          callId,
          callSiteId: callSiteIdOf(testId, module, exp, depth, sequence),
          module,
          export: exp,
          depth,
          sequence,
          argsFingerprint: fingerprint(args),
          mutated: false,
          args: args as ProbeEvent['args'],
        }),
      )
      events.push(
        c.throws !== undefined
          ? ev('TARGET_THROW', {
              testId,
              callId,
              error: {
                name: c.throws.name,
                message: c.throws.message ?? '',
                stack: '',
                constructorChain: c.throws.chain ?? [c.throws.name, 'Error'],
              },
            })
          : ev('TARGET_RETURN', {
              testId,
              callId,
              async: false,
              value: (c.returns ?? null) as ProbeEvent['value'],
            }),
      )
    }
  }
  for (const [module, exps] of modules)
    events.push(ev('DISCOVER', { module, wrapped: [...exps], unsupported: [] }))
  return {
    process: proc(),
    tests: tests.map((t) => ({
      testId: testIdOf(t.file ?? 'tests/a.test.js', t.name, 0),
      file: t.file ?? 'tests/a.test.js',
      name: t.name,
      status: t.status ?? 'passed',
      durationMs: 5,
    })),
    events,
    truncatedLines: 0,
    invalidLines: 0,
    ...over,
  }
}
