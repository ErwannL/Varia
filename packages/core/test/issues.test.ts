import { describe, expect, it } from 'vitest'
import {
  firstProjectFrame,
  groupIssues,
  issueOf,
  normalizeMessage,
  severityOf,
} from '../src/issues.js'
import { countResults, resilienceRate } from '../src/metrics.js'
import type { Classification } from '../src/oracle.js'
import { mutation } from './fixtures.js'

const crash = (
  message: string,
  stack = '    at createUser (/p/src/users.js:14:24)',
): Classification => ({
  status: 'CRASH',
  testStatus: 'failed',
  error: { name: 'TypeError', message, stack, constructorChain: ['TypeError', 'Error'] },
})

describe('issues (CDC §20)', () => {
  it('normalise les messages', () => {
    expect(normalizeMessage(`Cannot read 'x' of "y" at 12 0x1F`)).toBe(
      'Cannot read <str> of <str> at <num> <num>',
    )
  })
  it('premier cadre du projet, relatif, sans colonne', () => {
    const stack = [
      '    at x (node:internal/a:1:1)',
      '    at y (/p/node_modules/z.js:1:1)',
      '    at createUser (/p/src/users.js:14:24)',
    ].join('\n')
    expect(firstProjectFrame(stack, '/p')).toBe('createUser (src/users.js:14)')
    expect(firstProjectFrame('    at /p/src/a.js:3:9', '/p')).toBe('<anonymous> (src/a.js:3)')
    expect(firstProjectFrame('no frames', '/p')).toBeNull()
  })
  it('mêmes erreurs ⇒ une issue ; message différent ⇒ deux', () => {
    const results = [
      { mutation: mutation({ id: 'a' }), classification: crash('name.trim is not a function') },
      { mutation: mutation({ id: 'b' }), classification: crash('name.trim is not a function') },
      {
        mutation: mutation({ id: 'c' }),
        classification: crash(`Cannot destructure property 'name'`),
      },
    ]
    const issues = groupIssues(results, '/p')
    expect(issues.map((i) => i.mutationIds)).toEqual(expect.arrayContaining([['a', 'b'], ['c']]))
    expect(issues).toHaveLength(2)
  })
  it('timeout, sortie anormale, ressource, acceptation suspecte, inattendue, dépendance', () => {
    const k = (c: Classification) =>
      issueOf({ mutation: mutation(), classification: c }, '/p')?.kind
    expect(k({ status: 'TIMEOUT', testStatus: null })).toBe('TIMEOUT')
    expect(k({ status: 'CRASH', subtype: 'PROCESS_EXIT', testStatus: null })).toBe('PROCESS_EXIT')
    expect(k({ status: 'CRASH', subtype: 'RESOURCE_LIMIT', testStatus: null })).toBe(
      'RESOURCE_LIMIT',
    )
    expect(
      k({ status: 'PASSED', subtype: 'SUSPICIOUS_ACCEPT', reason: 'ECHO', testStatus: 'passed' }),
    ).toBe('SUSPICIOUS_ACCEPT')
    expect(k({ ...crash('x'), status: 'UNEXPECTED_FAILURE' })).toBe('UNEXPECTED')
    expect(k({ ...crash('x'), subtype: 'DEPENDENCY_ERROR' })).toBe('DEPENDENCY_ERROR')
    expect(k({ status: 'HANDLED', testStatus: 'failed' })).toBeUndefined()
    expect(k({ status: 'PASSED', testStatus: 'passed' })).toBeUndefined()
  })
  it('acceptation suspecte sans raison, cadre hors projet, frame anonyme', () => {
    const i = issueOf(
      {
        mutation: mutation(),
        classification: { status: 'PASSED', subtype: 'SUSPICIOUS_ACCEPT', testStatus: null },
      },
      '/p',
    )
    expect([i?.errorName, i?.message]).toEqual([null, 'arg0'])
    expect(firstProjectFrame('    at f (/autre/lib.js:3:1)', '/p')).toBe('f (/autre/lib.js:3)')
    expect(firstProjectFrame('    at weird line', '/p')).toBeNull()
  })
  it('gravité (CDC §19) et tri', () => {
    expect(
      [
        'TIMEOUT',
        'PROCESS_EXIT',
        'RESOURCE_LIMIT',
        'ERROR',
        'UNEXPECTED',
        'SUSPICIOUS_ACCEPT',
        'DEPENDENCY_ERROR',
      ].map((k) => severityOf(k as never)),
    ).toEqual(['CRITICAL', 'CRITICAL', 'CRITICAL', 'HIGH', 'MEDIUM', 'MEDIUM', 'MEDIUM'])
    const issues = groupIssues(
      [
        {
          mutation: mutation({ id: 'a' }),
          classification: {
            status: 'PASSED',
            subtype: 'SUSPICIOUS_ACCEPT',
            reason: 'ECHO',
            testStatus: null,
          },
        },
        {
          mutation: mutation({ id: 'b' }),
          classification: { status: 'TIMEOUT', testStatus: null },
        },
      ],
      '/p',
    )
    expect(issues.map((i) => i.severity)).toEqual(['CRITICAL', 'MEDIUM'])
  })
})

describe('métriques (CDC §22)', () => {
  it('comptes bruts et taux secondaire', () => {
    const results: Classification[] = [
      { status: 'HANDLED', testStatus: null },
      { status: 'PASSED', testStatus: null },
      { status: 'PASSED', subtype: 'SUSPICIOUS_ACCEPT', testStatus: null },
      { status: 'CRASH', testStatus: null },
      { status: 'TIMEOUT', testStatus: null },
      { status: 'SKIPPED', testStatus: null },
      { status: 'INFRA_ERROR', testStatus: null },
      { status: 'UNEXPECTED_FAILURE', testStatus: null },
      { status: 'EXPECTED_FAILURE', testStatus: null },
    ]
    const c = countResults(10, results)
    expect(c).toEqual({
      mutations: 10,
      handled: 1,
      expected: 1,
      passed: 2,
      suspicious: 1,
      unexpected: 1,
      crashes: 1,
      timeouts: 1,
      skipped: 1,
      infra: 1,
      pending: 1,
    })
    expect(resilienceRate(c)).toBeCloseTo(3 / 7)
    expect(resilienceRate(countResults(0, []))).toBeNull()
  })
})

describe('issue de lenteur (A-10)', () => {
  it('une issue SLOW (LOW) par target, en plus de l’issue principale éventuelle', () => {
    const slow: Classification = { status: 'PASSED', testStatus: 'passed', flags: ['SLOW'] }
    const drafts = groupIssues(
      [
        { mutation: mutation({ id: 'm_1' }), classification: slow },
        { mutation: mutation({ id: 'm_2' }), classification: { ...crash('x'), flags: ['SLOW'] } },
        {
          mutation: mutation({ id: 'm_3' }),
          classification: { status: 'PASSED', testStatus: null },
        },
      ],
      '/p',
    )
    expect(drafts.map((d) => [d.kind, d.severity, d.mutationIds])).toEqual([
      ['ERROR', 'HIGH', ['m_2']],
      ['SLOW', 'LOW', ['m_1', 'm_2']],
    ])
    expect(severityOf('SLOW')).toBe('LOW')
  })
})
