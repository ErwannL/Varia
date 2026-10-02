// Fuzz en processus (adapter scripté) : persistance, reprise, budget, interruption, cache, acceptations.
import { describe, expect, it } from 'vitest'
import {
  acceptanceStore,
  analyze,
  loadAcceptances,
  planRun,
  readPlan,
  runBaseline,
  runFuzz,
  type EngineContext,
} from '../src/index.js'
import { context, scripted } from './fake.js'

const TESTS = [
  { name: 'a', calls: [{ export: 'f', args: [{ name: 'Ada' }] }] },
  { name: 'b', calls: [{ export: 'g', args: ['x'] }] },
]
const YML = "version: 1\nmutations: { seed: 3, per_input: 2, strategies: ['null', type] }\n"
const crashF = scripted(TESTS, (m) =>
  m.export === 'f' ? { throws: { name: 'TypeError', message: 'boom' } } : { returns: m.value },
)

async function planned(ctx: EngineContext) {
  const b = await runBaseline(ctx)
  planRun(ctx, b.runId)
  return b.runId
}

describe('runFuzz', () => {
  it('chaque résultat persisté, issues regroupées, progression émise', async () => {
    const events: string[] = []
    const ctx = context(crashF, YML)
    Object.assign(ctx, { emit: (e: { type: string }) => events.push(e.type) })
    const id = await planned(ctx)
    const s = await runFuzz(ctx, id)
    const n = readPlan(ctx.reader.getRun(id)?.planPath ?? '').mutations.length
    expect(s).toMatchObject({
      executed: n,
      alreadyDone: 0,
      pending: 0,
      partial: false,
      aborted: false,
      budgetCut: false,
    })
    expect(ctx.reader.results(id)).toHaveLength(n)
    expect(ctx.reader.getRun(id)?.state).toBe('COMPLETED')
    expect(ctx.reader.issues(id).map((i) => i.kind)).toContain('ERROR')
    expect(events.filter((e) => e === 'mutation')).toHaveLength(n)
    // Reprise : rien n'est rejoué.
    const again = await runFuzz(ctx, id)
    expect([again.executed, again.alreadyDone]).toEqual([0, n])
    ctx.close()
  })
  it('budget de temps et interruption : run partiel annoncé, jamais silencieux', async () => {
    const ctx = context(crashF, YML)
    const id = await planned(ctx)
    const cut = await runFuzz(ctx, id, { maxTimeMs: 0 })
    expect([cut.partial, cut.budgetCut, cut.executed]).toEqual([true, true, 0])
    const ac = new AbortController()
    ac.abort()
    const stopped = await runFuzz(ctx, id, { signal: ac.signal })
    expect([stopped.aborted, stopped.budgetCut]).toEqual([true, false])
    expect(ctx.reader.getRun(id)?.state).toBe('ABORTED')
    ctx.close()
  })
  it('run sans plan ⇒ PROJECT_FAILURE', async () => {
    const ctx = context(crashF, YML)
    const b = await runBaseline(ctx)
    await expect(runFuzz(ctx, b.runId)).rejects.toMatchObject({ kind: 'PROJECT_FAILURE' })
    await expect(runFuzz(ctx, 'r_inconnu')).rejects.toMatchObject({ kind: 'PROJECT_FAILURE' })
    ctx.close()
  })
  it('cache : second run servi par le cache ; --no-cache l’ignore', async () => {
    const ctx = context(crashF, `${YML}cache: { enabled: true }\n`)
    const a = await planned(ctx)
    await runFuzz(ctx, a)
    expect(ctx.reader.getRun(a)?.info['cache']).toMatchObject({ hits: 0 })
    const b = await planned(ctx)
    await runFuzz(ctx, b)
    const hits = ctx.reader.getRun(b)?.info['cache'] as { hits: number; misses: number }
    expect(hits.misses).toBe(0)
    expect(hits.hits).toBeGreaterThan(0)
    expect(ctx.reader.events(b, 'CACHE_HIT').length).toBe(hits.hits)
    const c = await planned(ctx)
    await runFuzz(ctx, c, { noCache: true })
    expect(ctx.reader.getRun(c)?.info['cache']).toBeUndefined()
    ctx.close()
  })
})

describe('acceptations (B-06)', () => {
  it('store: db par défaut — base seulement', async () => {
    const ctx = context(crashF, YML)
    expect(acceptanceStore(ctx)).toBe('db')
    const id = await planned(ctx)
    ctx.writer.addAcceptance({
      id: 'a_1',
      projectId: ctx.projectId,
      function: 'src/a.js#f',
      path: null,
      strategy: null,
      reason: 'r',
      owner: null,
      expires: null,
    })
    expect(loadAcceptances(ctx).map((a) => [a.id, a.source, a.path])).toEqual([
      ['a_1', 'db', undefined],
    ])
    await runFuzz(ctx, id)
    expect(ctx.reader.issues(id).find((i) => i.kind === 'ERROR')?.state).toBe('ACCEPTED')
    expect(ctx.reader.getRun(id)?.info['acceptanceStore']).toBe('db')
    ctx.close()
  })
  it('store: file (forme longue) — fichier seulement, la base est ignorée', async () => {
    const ctx = context(
      crashF,
      `${YML}acceptances: { store: file, items: [{ mutation_pattern: { function: src/a.js#f, path: arg0, strategy: 'null' }, reason: r, owner: o, expires: '2999-01-01' }] }\n`,
    )
    await planned(ctx)
    ctx.writer.addAcceptance({
      id: 'a_db',
      projectId: ctx.projectId,
      function: 'x',
      path: 'p',
      strategy: 's',
      reason: 'r',
      owner: 'o',
      expires: '2999-01-01',
    })
    expect(acceptanceStore(ctx)).toBe('file')
    expect(loadAcceptances(ctx)).toEqual([
      {
        id: 'file:0',
        source: 'file',
        function: 'src/a.js#f',
        path: 'arg0',
        strategy: 'null',
        reason: 'r',
        owner: 'o',
        expires: '2999-01-01',
      },
    ])
    ctx.close()
  })
  it('analyze ignore un résultat dont la mutation n’est plus dans le plan', async () => {
    const ctx = context(crashF, YML)
    const id = await planned(ctx)
    ctx.writer.saveResult(id, {
      mutationId: 'm_fantome',
      status: 'CRASH',
      subtype: null,
      reason: null,
      outcome: 'throw',
      testStatus: 'failed',
      durationMs: 1,
      exitCode: 1,
      signal: null,
      timedOut: false,
      error: { name: 'TypeError', message: 'x', stack: '', constructorChain: ['TypeError'] },
      echoPath: null,
    })
    analyze(ctx, id, readPlan(ctx.reader.getRun(id)?.planPath ?? ''))
    expect(ctx.reader.issues(id)).toEqual([])
    ctx.close()
  })
})
