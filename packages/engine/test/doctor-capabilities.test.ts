// D-01 : `doctor` exécute un test de fumée PAR capacité et enregistre statut + raison ; une capacité
// non exercée n'est jamais VERIFIED par défaut.
import type { AdapterCapabilities, AdapterRun, AdapterRunOptions } from '@varia/core'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { doctor, lastDoctorVerification } from '../src/index.js'
import {
  CAPS,
  context,
  ev,
  FakeAdapter,
  fuzzRun,
  observeRun,
  project,
  type Script,
} from './fake.js'

/** Adapter scripté dont les capacités DÉCLARÉES sont choisies par le test. */
class Declared extends FakeAdapter {
  constructor(
    script: Script,
    private readonly caps: Partial<AdapterCapabilities> = {},
    detected?: { detected: boolean; nativeEsm: boolean },
  ) {
    super(script, detected)
  }
  override capabilities(): AdapterCapabilities {
    return { ...CAPS, ...this.caps }
  }
}

const TESTS = [{ name: 'a', calls: [{ args: [{ name: 'Ada' }] }] }]

/** Sonde de mutation dans un processus distinct (pid 2) de l'observation (pid 1). */
const otherPid = (f: AdapterRun): AdapterRun => ({
  ...f,
  events: f.events.map((e) => (e.type === 'HELLO' ? { ...e, pid: 2 } : e)),
})

async function check(
  caps: Partial<AdapterCapabilities>,
  observe: (o: AdapterRunOptions) => AdapterRun = () => observeRun(TESTS),
  fuzz: (f: AdapterRun, o: AdapterRunOptions) => AdapterRun = otherPid,
  root?: string,
) {
  const adapter = new Declared(
    (o) => (o.mode === 'observe' ? observe(o) : fuzz(fuzzRun(o), o)),
    caps,
  )
  const ctx = context(adapter, undefined, root)
  const r = await doctor(ctx)
  ctx.close()
  return { r, adapter, dataDir: ctx.dataDir }
}

describe('doctor : un test de fumée par capacité (D-01)', () => {
  it('statut et raison de chaque capacité, persistés pour les runs suivants', async () => {
    const { r, dataDir } = await check({})
    expect(r.checks).toEqual({
      observation: { status: 'VERIFIED', reason: null },
      argumentMutation: { status: 'VERIFIED', reason: null },
      perTestSelection: { status: 'VERIFIED', reason: null },
      asyncTargets: { status: 'NOT_VERIFIED', reason: 'NO_ASYNC_CALL_OBSERVED' },
      esm: { status: 'UNSUPPORTED', reason: 'NOT_DECLARED' },
      cjs: { status: 'VERIFIED', reason: null },
      mocks: { status: 'UNSUPPORTED', reason: 'NOT_DECLARED' },
      testParameters: { status: 'NOT_VERIFIED', reason: 'NO_SMOKE_TEST' },
      coverage: { status: 'UNSUPPORTED', reason: 'NOT_DECLARED' },
      isolatedProcess: { status: 'VERIFIED', reason: null },
      parallelSafe: { status: 'UNSUPPORTED', reason: 'NOT_DECLARED' },
    })
    expect(r.verified.isolatedProcess).toBe('VERIFIED')
    const saved = lastDoctorVerification(dataDir, 'fake')
    expect(saved?.checks).toEqual(r.checks)
    expect(saved?.at).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(lastDoctorVerification(dataDir, 'jest')).toBeNull()
    expect(lastDoctorVerification(join(dataDir, 'absent'), 'fake')).toBeNull()
    const f = join(dataDir, 'doctor.json')
    writeFileSync(
      f,
      readFileSync(f, 'utf8').replace(/"variaVersion": "[^"]*"/, '"variaVersion": "0"'),
    )
    expect(lastDoctorVerification(dataDir, 'fake')).toBeNull()
  })
  it('mocks et paramètres déclarés : jamais VERIFIED sans test de fumée dédié', async () => {
    const { r } = await check({ mocks: true, testParameters: true })
    expect(r.checks.mocks).toEqual({ status: 'NOT_VERIFIED', reason: 'NO_SMOKE_TEST' })
    expect(r.checks.testParameters).toEqual({ status: 'NOT_VERIFIED', reason: 'NO_SMOKE_TEST' })
  })
  it('isolation : même processus que l’observation ou que Varia, ou pid absent ⇒ non vérifiée', async () => {
    const cases: [(f: AdapterRun) => AdapterRun, string][] = [
      [(f) => f, 'SAME_PROCESS'],
      [
        (f) => ({
          ...f,
          events: f.events.map((e) => (e.type === 'HELLO' ? { ...e, pid: process.pid } : e)),
        }),
        'SAME_PROCESS',
      ],
      [(f) => ({ ...f, events: f.events.filter((e) => e.type !== 'HELLO') }), 'NO_PROBE_PID'],
    ]
    for (const [fuzz, reason] of cases) {
      const { r } = await check({}, undefined, fuzz)
      expect(r.checks.isolatedProcess).toEqual({ status: 'NOT_VERIFIED', reason })
    }
    const { r } = await check({ isolatedProcess: false })
    expect(r.checks.isolatedProcess).toEqual({ status: 'UNSUPPORTED', reason: 'NOT_DECLARED' })
  })
  it('couverture déclarée : VERIFIED seulement si le runner produit un résumé', async () => {
    const row = { file: 'src/a.js', lines: 100, statements: 100, functions: 100, branches: 100 }
    const ok = await check({ coverage: true }, (o) => ({
      ...observeRun(TESTS),
      ...(o.coverage === true ? { coverage: [row] } : {}),
    }))
    expect(ok.r.checks.coverage).toEqual({ status: 'VERIFIED', reason: null })
    expect(ok.adapter.runs.find((o) => o.mode === 'observe')?.coverage).toBe(true)
    const ko = await check({ coverage: true })
    expect(ko.r.checks.coverage).toEqual({
      status: 'NOT_VERIFIED',
      reason: 'COVERAGE_NOT_PRODUCED',
    })
    const none = await check({})
    expect(none.adapter.runs.find((o) => o.mode === 'observe')?.coverage).toBeUndefined()
  })
  it('parallélisme déclaré : deux exécutions simultanées identiques ⇒ VERIFIED', async () => {
    const ok = await check({ parallelSafe: true })
    expect(ok.r.checks.parallelSafe).toEqual({ status: 'VERIFIED', reason: null })
    expect(ok.adapter.runs.filter((o) => o.mode === 'fuzz')).toHaveLength(3)
    const dirs = ok.adapter.runs.filter((o) => o.mode === 'fuzz').map((o) => o.runDir)
    expect(new Set(dirs).size).toBe(3)
  })
  it('parallélisme : résultat divergent, absent ou mutation non appliquée ⇒ non vérifié', async () => {
    const twins: ((f: AdapterRun) => AdapterRun)[] = [
      (f) => ({ ...f, tests: (f.tests ?? []).map((t) => ({ ...t, status: 'failed' })) }),
      (f) => ({ ...f, tests: null }),
      (f) => ({ ...f, events: f.events.filter((e) => e.type !== 'MUTATE_CALL') }),
    ]
    for (const twin of twins) {
      const { r } = await check({ parallelSafe: true }, undefined, (f, o) =>
        o.runDir.endsWith('p2') ? twin(otherPid(f)) : otherPid(f),
      )
      expect(r.checks.parallelSafe).toEqual({
        status: 'NOT_VERIFIED',
        reason: 'PARALLEL_RESULTS_DIFFER',
      })
    }
  })
  it('cible asynchrone observée ⇒ asyncTargets VERIFIED', async () => {
    const { r } = await check({}, () => {
      const run = observeRun(TESTS)
      run.events = run.events.map((e) => (e.type === 'TARGET_RETURN' ? { ...e, async: true } : e))
      return run
    })
    expect(r.checks.asyncTargets).toEqual({ status: 'VERIFIED', reason: null })
  })
  it('projet ESM : esm vérifié, cjs déclaré mais non exercé (autre système de modules)', async () => {
    const root = project()
    writeFileSync(join(root, 'package.json'), '{"type":"module"}')
    const { r } = await check({ esm: true }, undefined, undefined, root)
    expect(r.checks.esm).toEqual({ status: 'VERIFIED', reason: null })
    expect(r.checks.cjs).toEqual({ status: 'NOT_VERIFIED', reason: 'OTHER_MODULE_SYSTEM' })
    const cjs = await check({ esm: true })
    expect(cjs.r.checks.esm).toEqual({ status: 'NOT_VERIFIED', reason: 'OTHER_MODULE_SYSTEM' })
  })
  it('raisons des échecs de mutation et de sélection', async () => {
    const { r } = await check({}, undefined, (f) => ({
      ...otherPid(f),
      events: f.events.filter((e) => e.type !== 'MUTATE_CALL'),
      tests: null,
    }))
    expect(r.checks.argumentMutation).toEqual({
      status: 'NOT_VERIFIED',
      reason: 'MUTATION_NOT_APPLIED',
    })
    expect(r.checks.perTestSelection).toEqual({ status: 'NOT_VERIFIED', reason: 'OTHER_TESTS_RAN' })
    const none = await check({}, () => observeRun([{ name: 'a', calls: [{ args: [] }] }]))
    expect(none.r.checks.argumentMutation).toEqual({
      status: 'NOT_VERIFIED',
      reason: 'NO_MUTABLE_INPUT',
    })
    expect(none.r.checks.isolatedProcess).toEqual({
      status: 'NOT_VERIFIED',
      reason: 'NOT_EXERCISED',
    })
    const off = await check({ argumentMutation: false }, () =>
      observeRun([{ name: 'a', calls: [{ args: [] }] }]),
    )
    expect(off.r.checks.argumentMutation).toEqual({ status: 'UNSUPPORTED', reason: 'NOT_DECLARED' })
  })
  it('ESM natif, aucune sonde, runner absent : raisons explicites, verdict persisté', async () => {
    const esm = new Declared(() => observeRun(TESTS), {}, { detected: true, nativeEsm: true })
    const ctx = context(esm)
    const r = await doctor(ctx)
    ctx.close()
    expect(r.checks.observation).toEqual({ status: 'UNSUPPORTED', reason: 'NATIVE_ESM' })
    expect(r.checks.argumentMutation).toEqual({ status: 'UNSUPPORTED', reason: 'NATIVE_ESM' })
    expect(existsSync(join(ctx.dataDir, 'doctor.json'))).toBe(true)
    const wrap = await check({}, () => observeRun([], { events: [ev('HELLO', { pid: 1 })] }))
    expect(wrap.r.checks.observation).toEqual({
      status: 'UNSUPPORTED',
      reason: 'NO_TARGET_MODULE_WRAPPED',
    })
    const absent = new Declared(() => observeRun(TESTS), {}, { detected: false, nativeEsm: false })
    const c2 = context(absent)
    const r2 = await doctor(c2)
    c2.close()
    expect(r2.checks.observation).toEqual({ status: 'NOT_VERIFIED', reason: 'NOT_EXERCISED' })
  })
  it('asynchrone non déclaré : UNSUPPORTED, jamais « non observé »', async () => {
    const { r } = await check({ asyncTargets: false })
    expect(r.checks.asyncTargets).toEqual({ status: 'UNSUPPORTED', reason: 'NOT_DECLARED' })
    const deep = await check({}, () =>
      observeRun([{ name: 'a', calls: [{ args: [{ n: 1 }] }, { args: [1], depth: 1 }] }]),
    )
    expect(deep.r.reasons).toContain('TRANSITIVE_CALLS_OBSERVED')
  })
  it('parallélisme : exécution séquentielle sans rapport de tests ⇒ non vérifié', async () => {
    const { r } = await check({ parallelSafe: true }, undefined, (f, o) =>
      o.runDir.endsWith('fuzz') ? { ...otherPid(f), tests: null } : otherPid(f),
    )
    expect(r.checks.parallelSafe.reason).toBe('PARALLEL_RESULTS_DIFFER')
  })
  it('projet modifié pendant le test de fumée : PROJECT_MUTATED, aucune vérification persistée', async () => {
    const root = project()
    const adapter = new Declared((o) => {
      if (o.mode === 'observe') writeFileSync(join(root, 'intrus.js'), '1')
      return o.mode === 'observe' ? observeRun(TESTS) : otherPid(fuzzRun(o))
    })
    const ctx = context(adapter, undefined, root)
    await expect(doctor(ctx)).rejects.toMatchObject({ kind: 'PROJECT_MUTATED' })
    ctx.close()
    expect(existsSync(join(ctx.dataDir, 'doctor.json'))).toBe(false)
  })
})

describe('vérification de doctor recopiée dans le run (D-01)', () => {
  it('baseline après doctor : run.info.verified ; sans doctor : absente', async () => {
    const { runBaseline } = await import('../src/index.js')
    const adapter = new FakeAdapter((o) =>
      o.mode === 'observe' ? observeRun(TESTS) : otherPid(fuzzRun(o)),
    )
    const ctx = context(adapter)
    const before = await runBaseline(ctx)
    expect(ctx.reader.getRun(before.runId)?.info['verified']).toBeUndefined()
    await doctor(ctx)
    const v = lastDoctorVerification(ctx.dataDir, adapter.id)
    expect(v).not.toBeNull()
    const after = await runBaseline(ctx)
    expect(ctx.reader.getRun(after.runId)?.info['verified']).toEqual(v)
    ctx.close()
  })
})
