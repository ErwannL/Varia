import type { Json } from '@varia/probe-protocol'
import type { InputDescriptor } from '../src/catalog.js'
import type { ObservedCall } from '../src/observe.js'
import type { PlanOptions, PlannedMutation } from '../src/plan.js'
import { STRATEGY_IDS } from '../src/strategies/index.js'

export const call = (over: Partial<ObservedCall> = {}): ObservedCall => ({
  callId: 1,
  callSiteId: 'c_1',
  testId: 't_1',
  module: 'src/a.js',
  export: 'f',
  depth: 0,
  sequence: 0,
  argsFingerprint: 'fp',
  args: [{ name: 'x', age: 3, password: { $redacted: true, fingerprint: 'h', type: 'string' } }],
  mutated: false,
  outcome: { kind: 'return', async: false },
  ...over,
})

export const input = (
  original: Json,
  type: string,
  over: Partial<InputDescriptor> = {},
): InputDescriptor => ({
  callSiteId: 'c_1',
  testId: 't_1',
  module: 'src/a.js',
  export: 'f',
  depth: 0,
  sequence: 0,
  argsFingerprint: 'fp',
  path: ['0'],
  pathStr: 'arg0',
  type,
  original,
  inObject: false,
  mutable: true,
  ...over,
})

export const planOptions = (over: Partial<PlanOptions> = {}): PlanOptions => ({
  seed: 9,
  perInput: 4,
  strategies: STRATEGY_IDS,
  variaVersion: '0.1.0',
  configHash: 'cfg',
  tests: new Map([['t_1', { file: 'tests/a.test.js', name: 'a' }]]),
  ...over,
})

export const mutation = (over: Partial<PlannedMutation> = {}): PlannedMutation => ({
  id: 'm_1',
  callSiteId: 'c_1',
  testId: 't_1',
  testFile: 'tests/a.test.js',
  testName: 'a',
  module: 'src/a.js',
  export: 'f',
  depth: 0,
  sequence: 0,
  argsFingerprint: 'fp',
  path: ['0'],
  pathStr: 'arg0',
  strategy: 'type',
  op: 'set',
  original: 'x',
  value: {},
  originalType: 'string',
  mutatedType: 'object',
  ...over,
})
