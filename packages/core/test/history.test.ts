import { describe, expect, it } from 'vitest'
import { diffIssues, issueStates } from '../src/history.js'

const c = (id: string, count: number, target = 't') => ({ id, count, target })

describe('états d’issues (CDC §20.4)', () => {
  it('NEW, REGRESSION, UNCHANGED, IMPROVED, WORSENED', () => {
    const r = issueStates({
      current: [c('new', 1), c('back', 2), c('same', 3), c('better', 1), c('worse', 5)],
      previous: [c('same', 3), c('better', 4), c('worse', 2)],
      everSeen: new Set(['back', 'same', 'better', 'worse']),
      executedTargets: new Set(['t']),
    })
    expect(Object.fromEntries(r.present)).toEqual({
      new: 'NEW',
      back: 'REGRESSION',
      same: 'UNCHANGED',
      better: 'IMPROVED',
      worse: 'WORSENED',
    })
    expect(r.absent).toEqual([])
  })
  it('FIXED seulement si la cible a été rejouée, sinon UNKNOWN', () => {
    const r = issueStates({
      current: [],
      previous: [c('a', 1, 'x'), c('b', 1, 'y')],
      everSeen: new Set(),
      executedTargets: new Set(['x']),
    })
    expect(r.absent).toEqual([
      { issueId: 'a', state: 'FIXED' },
      { issueId: 'b', state: 'UNKNOWN' },
    ])
  })
  it('premier run : tout est NEW', () => {
    expect([
      ...issueStates({
        current: [c('a', 1)],
        previous: null,
        everSeen: new Set(),
        executedTargets: new Set(),
      }).present.values(),
    ]).toEqual(['NEW'])
  })
  it('diffIssues', () => {
    expect(
      diffIssues([c('a', 1), c('b', 2), c('d', 1)], [c('b', 3), c('c', 1), c('d', 1)]),
    ).toEqual({
      added: ['c'],
      removed: ['a'],
      changed: [{ id: 'b', before: 2, after: 3 }],
      unchanged: ['d'],
    })
  })
})
