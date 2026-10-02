// Rejeu d'une mutation (CDC §42) : résultat comparé à l'enregistré, environnement changé signalé.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EngineContext, planRun, replayMutation, runBaseline, runFuzz } from '../src/index.js'
import { FakeAdapter, fuzzRun, observeRun, project } from './fake.js'

const TESTS = [{ name: 'crée', calls: [{ args: [{ name: 'Ada' }] }] }]
const YML = "version: 1\nmutations: { seed: 1, per_input: 1, strategies: ['null'] }\n"

async function setup(behave: Parameters<typeof fuzzRun>[1]) {
  const root = project(YML)
  const adapter = new FakeAdapter((o) =>
    o.mode === 'observe' ? observeRun(TESTS) : fuzzRun(o, behave),
  )
  const ctx = new EngineContext({ root, adapter, dataDir: join(root, '.data') })
  const b = await runBaseline(ctx)
  const plan = planRun(ctx, b.runId)
  const id =
    (JSON.parse(readFileSync(plan.planPath, 'utf8')) as { mutations: { id: string }[] })
      .mutations[0]?.id ?? ''
  return { root, ctx, runId: b.runId, planPath: plan.planPath, id }
}

describe('varia replay', () => {
  it('sans résultat enregistré : previous null ; même environnement', async () => {
    const s = await setup(() => ({ returns: 1 }))
    const r = await replayMutation(s.ctx, s.id)
    expect([r.previous, r.sameAsRecorded, r.environmentChanged]).toEqual([null, null, false])
    expect(r.classification.status).toBe('PASSED')
    expect(s.ctx.reader.events(s.runId, 'MUTATION_REPLAYED')).toHaveLength(1)
    s.ctx.close()
  })
  it('comparé au résultat enregistré (statut et sous-type)', async () => {
    let crash = true
    const s = await setup(() => (crash ? { throws: { name: 'TypeError' } } : { returns: 1 }))
    await runFuzz(s.ctx, s.runId)
    const same = await replayMutation(s.ctx, s.id)
    expect([same.previous, same.sameAsRecorded]).toEqual([{ status: 'CRASH', subtype: null }, true])
    crash = false
    expect((await replayMutation(s.ctx, s.id)).sameAsRecorded).toBe(false)
    s.ctx.close()
  })
  it('sous-type différent ⇒ pas identique ; configuration changée ⇒ environnement changé', async () => {
    let exit = true
    const s = await setup(() =>
      exit
        ? { returns: 1, process: { signal: 'SIGKILL' } }
        : { returns: 1, process: { stderr: 'JavaScript heap out of memory' } },
    )
    await runFuzz(s.ctx, s.runId)
    exit = false
    const r = await replayMutation(s.ctx, s.id)
    expect([r.previous?.subtype, r.classification.subtype, r.sameAsRecorded]).toEqual([
      'PROCESS_EXIT',
      'RESOURCE_LIMIT',
      false,
    ])
    s.ctx.close()
    writeFileSync(join(s.root, 'varia.yml'), `${YML}execution: { timeout_ms: 6000 }\n`)
    const other = new EngineContext({
      root: s.root,
      adapter: new FakeAdapter((o) => fuzzRun(o)),
      dataDir: join(s.root, '.data'),
    })
    expect((await replayMutation(other, s.id)).environmentChanged).toBe(true)
    other.close()
  })
  it('mutation absente du plan ou test inconnu de la baseline', async () => {
    const s = await setup(() => ({ returns: 1 }))
    const plan = JSON.parse(readFileSync(s.planPath, 'utf8')) as { mutations: { testId: string }[] }
    const [m] = plan.mutations
    writeFileSync(
      s.planPath,
      JSON.stringify({ ...plan, mutations: [{ ...m, testId: 't_inconnu' }] }),
    )
    expect((await replayMutation(s.ctx, s.id)).classification.status).toBe('PASSED')
    writeFileSync(s.planPath, JSON.stringify({ ...plan, mutations: [] }))
    await expect(replayMutation(s.ctx, s.id)).rejects.toMatchObject({ kind: 'PROJECT_FAILURE' })
    s.ctx.close()
  })
})
