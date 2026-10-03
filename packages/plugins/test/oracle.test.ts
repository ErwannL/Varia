// Entrée d'une règle d'oracle externe et application de son verdict (X-02).
import type { Classification, ObservedCall, PlannedMutation } from '@varia/core'
import { definePlugin, PLUGIN_API_VERSION, ruleInputOf, withVerdict } from '@varia/plugins'
import { describe, expect, it } from 'vitest'

const M = {
  id: 'm_1',
  module: 'src/m.js',
  export: 'f',
  pathStr: 'arg0.x',
  strategy: 'type',
  op: 'set',
  original: 'a',
  value: 1,
} as PlannedMutation
const CALL = {
  callId: 1,
  outcome: { kind: 'return', async: false, value: { x: 1 } },
} as unknown as ObservedCall
const C: Classification = {
  status: 'PASSED',
  subtype: 'SUSPICIOUS_ACCEPT',
  reason: 'ECHO',
  echoPath: 'return.x',
  outcome: 'return',
  testStatus: 'passed',
}

describe('règles d’oracle externes', () => {
  it('entrée : mutation, verdict intégré, issue de l’appel muté', () => {
    expect(ruleInputOf(M, C, CALL)).toEqual({
      mutation: {
        id: 'm_1',
        target: 'src/m.js#f',
        path: 'arg0.x',
        strategy: 'type',
        op: 'set',
        original: 'a',
        value: 1,
      },
      classification: { status: 'PASSED', subtype: 'SUSPICIOUS_ACCEPT', reason: 'ECHO' },
      outcome: { kind: 'return', value: { x: 1 }, error: null },
      testStatus: 'passed',
    })
    const err = { name: 'E', message: 'm', stack: '', constructorChain: [] }
    const thrown = { ...CALL, outcome: { kind: 'throw' as const, async: false, error: err } }
    expect(ruleInputOf(M, { status: 'CRASH', testStatus: null }, thrown)?.outcome).toEqual({
      kind: 'throw',
      value: null,
      error: err,
    })
  })

  it('hors du comportement de la cible (infra, délai, non atteint, signal de processus) : null', () => {
    expect(ruleInputOf(M, C, undefined)).toBeNull()
    for (const status of ['INFRA_ERROR', 'TIMEOUT', 'SKIPPED', 'EXPECTED_FAILURE'] as const)
      expect(ruleInputOf(M, { status, testStatus: null }, CALL)).toBeNull()
    for (const subtype of ['RESOURCE_LIMIT', 'PROCESS_EXIT', 'UNHANDLED_REJECTION'] as const)
      expect(ruleInputOf(M, { status: 'CRASH', subtype, testStatus: null }, CALL)).toBeNull()
    expect(
      ruleInputOf(M, { status: 'CRASH', subtype: 'DEPENDENCY_ERROR', testStatus: null }, CALL),
    ).not.toBeNull()
  })

  it('verdict : statut remplacé, raison traçable, sous-type et écho retirés ; même statut inchangé', () => {
    expect(withVerdict(C, { status: 'HANDLED', reason: 'OK', rule: 'p/r' })).toEqual({
      status: 'HANDLED',
      reason: 'RULE:p/r:OK',
      outcome: 'return',
      testStatus: 'passed',
    })
    expect(withVerdict(C, { status: 'PASSED', reason: 'OK', rule: 'p/r' })).toBe(C)
  })

  it('definePlugin : identité ; version du contrat publiée', () => {
    const p = { apiVersion: PLUGIN_API_VERSION, name: 'x' }
    expect(definePlugin(p)).toBe(p)
    expect(PLUGIN_API_VERSION).toBe(1)
  })
})
