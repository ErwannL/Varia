// `varia doctor` (CDC §9.2) : chaque capacité n'est VÉRIFIÉE que si le test de fumée l'a observée.
import type { AdapterRun, AdapterRunOptions } from '@varia/core'
import { describe, expect, it } from 'vitest'
import { doctor } from '../src/index.js'
import { context, ev, FakeAdapter, fuzzRun, observeRun, type FakeTest } from './fake.js'

const TESTS: FakeTest[] = [{ name: 'a', calls: [{ args: [{ name: 'Ada' }] }] }]

/** Doctor avec une observation donnée et une exécution de mutation transformée par `fuzz`. */
async function report(
  observe: AdapterRun,
  fuzz: (r: AdapterRun, o: AdapterRunOptions) => AdapterRun = (r) => r,
) {
  const adapter = new FakeAdapter((o) => (o.mode === 'observe' ? observe : fuzz(fuzzRun(o), o)))
  const ctx = context(adapter)
  const r = await doctor(ctx)
  ctx.close()
  return { r, fuzzRuns: adapter.runs.filter((x) => x.mode === 'fuzz').length }
}

describe('doctor : capacités vérifiées, jamais seulement déclarées', () => {
  it('fumée complète : observation, mutation et sélection par test vérifiées', async () => {
    const { r } = await report(observeRun(TESTS))
    expect(r.verdict).toBe('OK')
    expect(r.verified).toMatchObject({
      observation: 'VERIFIED',
      cjs: 'VERIFIED',
      argumentMutation: 'VERIFIED',
      perTestSelection: 'VERIFIED',
      esm: 'UNSUPPORTED',
    })
  })
  it('aucune sonde chargée ⇒ NO_TARGET_MODULE_WRAPPED, observation non supportée', async () => {
    const { r, fuzzRuns } = await report(observeRun([], { events: [] }))
    expect(r.verdict).toBe('UNSUPPORTED_PROBE')
    expect(r.reasons).toContain('NO_TARGET_MODULE_WRAPPED')
    expect(r.verified.observation).toBe('UNSUPPORTED')
    expect(fuzzRuns).toBe(0)
  })
  it('module enveloppé mais aucun appel : rien de vérifié, aucune mutation tentée', async () => {
    const run = observeRun([{ name: 'a', calls: [] }])
    run.events.push(ev('DISCOVER', { module: 'src/a.js', wrapped: ['f'], unsupported: [] }))
    const { r, fuzzRuns } = await report(run)
    expect(r.verdict).toBe('OK')
    expect([r.verified.observation, r.verified.cjs, r.verified.argumentMutation]).toEqual([
      'NOT_VERIFIED',
      'NOT_VERIFIED',
      'NOT_VERIFIED',
    ])
    expect(fuzzRuns).toBe(0)
  })
  it('entrée mutable sans mutation `null` possible : aucune exécution de mutation', async () => {
    const { r, fuzzRuns } = await report(observeRun([{ name: 'a', calls: [{ args: [null] }] }]))
    expect(r.verified.observation).toBe('VERIFIED')
    expect(r.verified.argumentMutation).toBe('NOT_VERIFIED')
    expect(fuzzRuns).toBe(0)
  })
  it('mutation non appliquée par la sonde ⇒ argumentMutation NON vérifiée', async () => {
    const { r } = await report(observeRun(TESTS), (f) => ({
      ...f,
      events: f.events.filter((e) => e.type !== 'MUTATE_CALL'),
    }))
    expect(r.verified.argumentMutation).toBe('NOT_VERIFIED')
    expect(r.verified.perTestSelection).toBe('VERIFIED')
  })
  it('sans rapport de tests ⇒ sélection par test NON vérifiée', async () => {
    const { r } = await report(observeRun(TESTS), (f) => ({ ...f, tests: null }))
    expect(r.verified.argumentMutation).toBe('VERIFIED')
    expect(r.verified.perTestSelection).toBe('NOT_VERIFIED')
  })
  it('un autre test exécuté en plus ⇒ sélection par test NON vérifiée', async () => {
    const { r } = await report(observeRun(TESTS), (f) => ({
      ...f,
      tests: [
        ...(f.tests ?? []),
        { testId: 'autre', file: 'tests/b.test.js', name: 'b', status: 'passed', durationMs: 1 },
      ],
    }))
    expect(r.verified.perTestSelection).toBe('NOT_VERIFIED')
  })
  it('runner absent ou ESM natif : verdict sans aucune exécution', async () => {
    for (const [detected, verdict] of [
      [{ detected: false, nativeEsm: false }, 'RUNNER_NOT_FOUND'],
      [{ detected: true, nativeEsm: true }, 'UNSUPPORTED_PROBE'],
    ] as const) {
      const adapter = new FakeAdapter(() => observeRun(TESTS), detected)
      const ctx = context(adapter)
      const r = await doctor(ctx)
      ctx.close()
      expect(r.verdict).toBe(verdict)
      expect(adapter.runs).toHaveLength(0)
      if (detected.nativeEsm) expect(r.verified.observation).toBe('UNSUPPORTED')
    }
  })
})
