import { openReader, Reader } from '@varia/database'
import { SEED_RUN, seedDatabase } from '@varia/testkit'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildReport,
  limitationsOf,
  reportJsonSchema,
  reportSchema,
  summarizeValue,
} from '../src/index.js'

function report() {
  const { dbPath } = seedDatabase()
  const o = openReader(dbPath)
  const r = buildReport(new Reader(o.db), SEED_RUN)
  o.close()
  return r
}

describe('rapport JSON (CDC §31)', () => {
  it('valide contre son schéma versionné', () => {
    const r = report()
    expect(reportSchema.safeParse(r).success).toBe(true)
    expect(r.schemaVersion).toBe(4)
  })
  it('comptes bruts, en attente, run partiel', () => {
    const r = report()
    expect(r.counts).toMatchObject({
      mutations: 7,
      crashes: 2,
      handled: 1,
      timeouts: 1,
      suspicious: 1,
      skipped: 1,
      pending: 1,
    })
    expect(r.run.partial).toBe(true)
    expect(r.resilienceRate).toBeCloseTo(1 / 5)
  })
  it('issues triées par gravité avec commande de rejeu', () => {
    const r = report()
    expect(r.issues.map((i) => i.severity)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM'])
    expect(r.issues[1]).toMatchObject({
      count: 2,
      errorName: 'TypeError',
      replay: 'varia replay m_crash1',
    })
  })
  it('non couvert et limites toujours listés', () => {
    const r = report()
    expect(r.notCovered).toMatchObject({
      neverCalled: ['src/math.js#helper'],
      transitiveOnly: ['src/text.js#inner'],
      unsupported: ['src/errors.js#ValidationError'],
      flakyTests: ['echoValue renvoie un horodatage'],
      skippedMutations: [{ id: 'm_skipped', reason: 'AMBIGUOUS_CALL_SITE' }],
      pendingMutations: 1,
    })
    expect(r.notCovered.nonMutableInputs).toEqual([
      { target: 'src/users.js#createUser', path: 'arg0.password', reason: 'REDACTED' },
    ])
    expect(r.limitations).toContain('INTERNAL_CALLS_NOT_OBSERVED')
    expect(limitationsOf('all')).not.toContain('TRANSITIVE_CALLS_NOT_MUTATED')
  })
  it('les grandes valeurs sont résumées', () => {
    expect(summarizeValue('x'.repeat(500))).toMatchObject({ $t: 'summary', chars: 502 })
    expect(summarizeValue({ a: 1 })).toEqual({ a: 1 })
  })
  it('run inconnu', () => {
    const { dbPath } = seedDatabase()
    const o = openReader(dbPath)
    expect(() => buildReport(new Reader(o.db), 'zz')).toThrow(/inconnu/)
    o.close()
  })
  it('schema/report.schema.json est à jour', () => {
    const onDisk = readFileSync(new URL('../schema/report.schema.json', import.meta.url), 'utf8')
    expect(JSON.parse(onDisk)).toEqual(JSON.parse(JSON.stringify(reportJsonSchema())))
  })
})
