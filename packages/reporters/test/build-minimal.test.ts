import { openReader, openWriter, Reader, Writer } from '@varia/database'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildReport, byId, summarizeValue } from '../src/index.js'

/** Base minimale : run sans `info`, enregistrements incomplets (anciens formats, champs absents). */
function minimalReport() {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'varia-min-')), 'varia.db')
  const o = openWriter(dbPath)
  const w = new Writer(o.db)
  w.upsertProject({ id: 'p1', name: 'min', root: '/m', framework: 'vitest' })
  w.createRun({
    id: 'r1',
    projectId: 'p1',
    state: 'COMPLETED',
    mode: 'normal',
    seed: null,
    gitCommit: null,
    gitBranch: null,
    variaVersion: '0.1.0',
    configHash: 'c',
    envHash: 'e',
    planPath: null,
    partial: false,
    info: {},
  })
  w.saveTests('r1', [
    { testId: 't1', file: 'a.test.js', name: 'échoue', status: 'failed', flakyReasons: [] },
    { testId: 't2', file: 'a.test.js', name: 'passe', status: 'passed', flakyReasons: [] },
  ])
  const base = {
    callSiteId: 'cs1',
    module: 'src/a.js',
    export: 'f',
    pathStr: 'arg0',
    strategy: 's',
  }
  w.saveMutations('r1', [
    // Sans `depth`, sans test connu ni `testName`.
    { ...base, id: 'm1', testId: 'inconnu' },
    { ...base, id: 'm2', testId: 't1' },
    { ...base, id: 'm3', testId: 't1', testName: 'nom porté', depth: 2 } as typeof base & {
      id: string
      testId: string
    },
  ])
  const res = {
    subtype: null,
    reason: null,
    outcome: null,
    testStatus: 'failed',
    durationMs: 1,
    exitCode: null,
    signal: null,
    timedOut: false,
    echoPath: null,
  }
  w.saveResult('r1', { ...res, mutationId: 'm1', status: 'CRASH', error: {} })
  w.saveResult('r1', { ...res, mutationId: 'm2', status: 'SKIPPED', error: null })
  w.saveInputs('r1', [
    {
      callSiteId: 'cs-absent',
      path: 'arg1',
      type: 'object',
      format: null,
      bounds: null,
      mutable: false,
      reason: null,
    },
  ])
  const issue = (id: string, severity: string, mutationIds: string[]) => ({
    fingerprint: id,
    kind: 'CRASH',
    severity,
    target: 'src/a.js#f',
    title: id,
    errorName: null,
    frame: null,
    message: null,
    mutationIds,
  })
  // Trois issues HIGH : départage par identifiant ; une issue pointe vers une mutation absente.
  w.saveIssues('r1', 'p1', [
    issue('i_c', 'HIGH', ['m1']),
    issue('i_a', 'HIGH', ['m_fantome']),
    {
      ...issue('i_b', 'HIGH', ['m3']),
      state: 'AMBIGUOUS_MATCH',
      matchedFrom: ['i_old1', 'i_old2'],
    },
    issue('i_y', 'LOW', ['m1']),
    issue('i_x', 'LOW', ['m1']),
  ])
  w.saveAbsentIssues('r1', [
    { issueId: 'i_y', state: 'FIXED' },
    { issueId: 'i_x', state: 'FIXED' },
  ])
  o.close()
  const r = openReader(dbPath)
  const rep = buildReport(new Reader(r.db), 'r1')
  r.close()
  return rep
}

describe('rapport sur une base minimale (champs absents)', () => {
  const r = minimalReport()
  it('valeurs par défaut du run : projet, adaptateur, profondeur, capacités', () => {
    expect(r.project).toEqual({ id: 'p1', name: 'p1', root: '' })
    expect(r.capabilities).toEqual({
      adapter: '',
      adapterVersion: null,
      declared: {},
      verified: {},
      verifiedAt: null,
    })
    expect(r.limitations).toContain('TRANSITIVE_CALLS_NOT_MUTATED')
    expect(r.limitations).toContain('NATIVE_ESM_UNSUPPORTED')
  })
  it('tests en échec listés dans la ligne de base', () => {
    expect(r.baseline.failing).toEqual(['échoue'])
    expect(r.baseline.passed).toBe(1)
  })
  it('issues : même sévérité départagée par identifiant, mutation absente ⇒ profondeur 0', () => {
    expect(r.issues.map((i) => i.id)).toEqual(['i_a', 'i_b', 'i_c'])
    expect(r.issues[0]).toMatchObject({
      depth: 0,
      transitive: false,
      replay: 'varia replay m_fantome',
    })
    expect(r.issues[1]).toMatchObject({ depth: 2, transitive: true })
    // C-01 : candidats du rapprochement exposés ; aucune fusion.
    expect(r.issues[1]).toMatchObject({
      state: 'AMBIGUOUS_MATCH',
      matchedFrom: ['i_old1', 'i_old2'],
    })
    expect(r.issues[0]?.matchedFrom).toEqual([])
  })
  it('issues résolues triées par identifiant', () => {
    expect(r.resolvedIssues.map((i) => i.id)).toEqual(['i_x', 'i_y'])
  })
  it('mutations : nom de test, profondeur et erreur par défaut', () => {
    const [m1, m2, m3] = r.mutations
    expect(m1).toMatchObject({ test: '', depth: 0, error: { name: '', message: '' } })
    expect(m2).toMatchObject({ test: 'échoue', error: null, status: 'SKIPPED' })
    expect(m3).toMatchObject({ test: 'échoue', depth: 2, status: null })
  })
  it('non couvert : site d’appel inconnu, raisons absentes ⇒ chaîne vide', () => {
    expect(r.notCovered.nonMutableInputs).toEqual([
      { target: 'cs-absent', path: 'arg1', reason: '' },
    ])
    expect(r.notCovered.skippedMutations).toEqual([{ id: 'm2', reason: '' }])
  })
})

describe('summarizeValue', () => {
  it('undefined reste tel quel (non sérialisable)', () => {
    expect(summarizeValue(undefined)).toBeUndefined()
  })
  it('grand tableau résumé avec son type', () => {
    const big = Array.from({ length: 100 }, (_, i) => i)
    expect(summarizeValue(big)).toMatchObject({ $t: 'summary', type: 'array' })
    expect(summarizeValue('x'.repeat(300))).toMatchObject({ type: 'string', chars: 302 })
  })
})

describe('byId', () => {
  it('ordre total : inférieur, supérieur, égal', () => {
    expect(byId({ id: 'a' }, { id: 'b' })).toBe(-1)
    expect(byId({ id: 'b' }, { id: 'a' })).toBe(1)
    expect(byId({ id: 'a' }, { id: 'a' })).toBe(0)
    expect([{ id: 'c' }, { id: 'a' }, { id: 'b' }].sort(byId).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})
