import { describe, expect, it } from 'vitest'
import { acceptanceMatches, evaluateAcceptances, type Acceptance } from '../src/acceptances.js'

const a = (over: Partial<Acceptance>): Acceptance => ({
  id: 'a',
  source: 'file',
  function: 'createUser',
  reason: 'r',
  ...over,
})
const m = (id: string, over = {}) => ({
  id,
  module: 'src/users.js',
  export: 'createUser',
  pathStr: 'arg0.age',
  strategy: 'boundary',
  ...over,
})

describe('acceptations (CDC §21)', () => {
  it('correspondance par fonction (export ou module#export), chemin, stratégie', () => {
    expect(acceptanceMatches(a({}), m('1'))).toBe(true)
    expect(
      acceptanceMatches(
        a({ function: 'src/users.js#createUser', path: 'arg0.age', strategy: 'boundary' }),
        m('1'),
      ),
    ).toBe(true)
    expect(acceptanceMatches(a({ path: 'arg0.name' }), m('1'))).toBe(false)
    expect(acceptanceMatches(a({ strategy: 'type' }), m('1'))).toBe(false)
    expect(acceptanceMatches(a({ function: 'other' }), m('1'))).toBe(false)
  })
  it('active, expirée (redevient visible), obsolète', () => {
    const e = evaluateAcceptances(
      [
        a({ id: 'ok' }),
        a({ id: 'old', expires: '2020-01-01' }),
        a({ id: 'none', function: 'ghost' }),
      ],
      [m('1'), m('2')],
      '2026-10-01',
    )
    expect([...e.accepted.entries()]).toEqual([
      ['1', 'ok'],
      ['2', 'ok'],
    ])
    expect(e.statuses.map((s) => [s.acceptance.id, s.status, s.matched])).toEqual([
      ['ok', 'ACTIVE', 2],
      ['old', 'EXPIRED', 2],
      ['none', 'OBSOLETE', 0],
    ])
  })
  it('expiration incluse le jour même', () => {
    expect(
      evaluateAcceptances([a({ expires: '2026-10-01' })], [m('1')], '2026-10-01').statuses[0]
        ?.status,
    ).toBe('ACTIVE')
  })
})
