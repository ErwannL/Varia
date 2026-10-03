import { describe, expect, it } from 'vitest'
import { MATCH_THRESHOLD, diffIssues, issueStates, matchScore } from '../src/history.js'

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
  it('run partiel : FIXED seulement si une mutation de l’issue a été rejouée (C-02)', () => {
    const r = issueStates({
      current: [],
      previous: [
        { ...c('a', 1, 'x'), mutationIds: ['m1'] },
        { ...c('b', 1, 'x'), mutationIds: ['m2'] },
        c('c', 1, 'x'),
      ],
      everSeen: new Set(),
      executedTargets: new Set(['x']),
      executedMutations: new Set(['m1']),
      partial: true,
    })
    expect(r.absent).toEqual([
      { issueId: 'a', state: 'FIXED' },
      { issueId: 'b', state: 'UNKNOWN' },
      { issueId: 'c', state: 'UNKNOWN' },
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

describe('rapprochement par empreinte secondaire (CDC §20.2-20.3, C-01)', () => {
  const sec = (
    codeHash: string | null,
    stackFiles = ['src/a.js', 't/a.test.js'],
    module = 'src/a.js',
  ) => ({
    module,
    stackFiles,
    codeHash,
  })
  const issue = (id: string, count: number, target: string, s = sec('h1'), kind = 'ERROR') => ({
    id,
    count,
    target,
    kind,
    secondary: s,
  })
  it('score : filtre strict (nature, module, empreinte présente), ½ pile + ½ extrait', () => {
    const a = issue('a', 1, 't')
    expect(matchScore(a, issue('b', 1, 't'))).toBe(1)
    expect(matchScore(a, issue('b', 1, 't', sec('h2')))).toBe(0.5)
    expect(matchScore(a, issue('b', 1, 't', sec('h1', ['src/a.js', 'x.js'])))).toBeCloseTo(2 / 3)
    expect(
      matchScore(a, issue('b', 1, 't', sec('h1', ['src/a.js', 't/a.test.js', 'x.js', 'y.js']))),
    ).toBe(0.75)
    expect(matchScore(a, issue('b', 1, 't', sec('h1', [])))).toBe(0.5)
    expect(matchScore(issue('a', 1, 't', sec(null, [])), issue('b', 1, 't', sec(null, [])))).toBe(0)
    expect(matchScore(a, issue('b', 1, 't', sec('h1', undefined, 'src/b.js')))).toBe(0)
    expect(matchScore(a, issue('b', 1, 't', sec('h1'), 'UNEXPECTED'))).toBe(0)
    expect(matchScore(a, { kind: 'ERROR', secondary: null })).toBe(0)
    expect(matchScore({ kind: 'ERROR' }, a)).toBe(0)
    expect(MATCH_THRESHOLD).toBe(0.75)
  })
  it('déplacement de ligne / renommage : un seul candidat ⇒ continuation, l’ancienne n’est pas FIXED', () => {
    const r = issueStates({
      current: [issue('new-id', 3, 'src/a.js#renamed')],
      previous: [issue('old-id', 2, 'src/a.js#f')],
      everSeen: new Set(),
      executedTargets: new Set(['src/a.js#f', 'src/a.js#renamed']),
    })
    expect(Object.fromEntries(r.present)).toEqual({ 'new-id': 'WORSENED' })
    expect(Object.fromEntries(r.matches)).toEqual({ 'new-id': ['old-id'] })
    expect(r.absent).toEqual([])
  })
  it('extrait différent (score sous le seuil) ⇒ NEW + FIXED, sans rapprochement', () => {
    const r = issueStates({
      current: [issue('n', 1, 'x', sec('h2'))],
      previous: [issue('o', 1, 'x')],
      everSeen: new Set(),
      executedTargets: new Set(['x']),
    })
    expect(Object.fromEntries(r.present)).toEqual({ n: 'NEW' })
    expect(r.matches.size).toBe(0)
    expect(r.absent).toEqual([{ issueId: 'o', state: 'FIXED' }])
  })
  it('deux candidats de référence ⇒ AMBIGUOUS_MATCH, candidats UNKNOWN (jamais FIXED)', () => {
    const r = issueStates({
      current: [issue('n', 1, 'x')],
      previous: [issue('o1', 1, 'x'), issue('o2', 1, 'x')],
      everSeen: new Set(),
      executedTargets: new Set(['x']),
    })
    expect(Object.fromEntries(r.present)).toEqual({ n: 'AMBIGUOUS_MATCH' })
    expect(Object.fromEntries(r.matches)).toEqual({ n: ['o1', 'o2'] })
    expect(r.absent).toEqual([
      { issueId: 'o1', state: 'UNKNOWN' },
      { issueId: 'o2', state: 'UNKNOWN' },
    ])
  })
  it('une référence revendiquée par deux issues courantes ⇒ AMBIGUOUS_MATCH des deux côtés', () => {
    const r = issueStates({
      current: [issue('n1', 1, 'x'), issue('n2', 1, 'y')],
      previous: [issue('o', 1, 'x')],
      everSeen: new Set(),
      executedTargets: new Set(['x', 'y']),
    })
    expect(Object.fromEntries(r.present)).toEqual({ n1: 'AMBIGUOUS_MATCH', n2: 'AMBIGUOUS_MATCH' })
    expect(r.absent).toEqual([{ issueId: 'o', state: 'UNKNOWN' }])
  })
  it('une issue toujours présente n’est jamais candidate', () => {
    const r = issueStates({
      current: [issue('o', 1, 'x'), issue('n', 1, 'x')],
      previous: [issue('o', 1, 'x')],
      everSeen: new Set(),
      executedTargets: new Set(['x']),
    })
    expect(Object.fromEntries(r.present)).toEqual({ o: 'UNCHANGED', n: 'NEW' })
  })
})
