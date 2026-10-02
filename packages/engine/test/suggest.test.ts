// CDC §18.7 : regroupement des UNEXPECTED_FAILURE du dernier run, sans rien deviner.
import { describe, expect, it } from 'vitest'
import { oracleSuggestions } from '../src/index.js'
import { context, FakeAdapter } from './fake.js'

const result = (mutationId: string, status: string, error: unknown) => ({
  mutationId,
  status,
  subtype: null,
  reason: null,
  outcome: 'throw',
  testStatus: 'failed',
  durationMs: 1,
  exitCode: 1,
  signal: null,
  timedOut: false,
  error,
  echoPath: null,
})

describe('oracleSuggestions', () => {
  it('sans run : aucune proposition', () => {
    const ctx = context(new FakeAdapter(() => Promise.reject(new Error('non utilisé'))))
    expect(oracleSuggestions(ctx)).toEqual({ runId: null, items: [] })
    ctx.close()
  })
  it('ignore les autres statuts et les erreurs sans nom ; tri par fréquence puis par nom', () => {
    const ctx = context(new FakeAdapter(() => Promise.reject(new Error('non utilisé'))))
    ctx.writer.upsertProject({ id: ctx.projectId, name: 'x', root: ctx.root, framework: 'jest' })
    ctx.writer.createRun({
      id: 'r1',
      projectId: ctx.projectId,
      state: 'COMPLETED',
      mode: 'normal',
      seed: 1,
      gitCommit: null,
      gitBranch: null,
      variaVersion: '0.1.0',
      configHash: 'c',
      envHash: 'e',
      planPath: null,
      partial: false,
      info: {},
    })
    const rows = [
      result('m1', 'CRASH', { name: 'TypeError' }),
      result('m2', 'UNEXPECTED_FAILURE', null),
      result('m3', 'UNEXPECTED_FAILURE', { message: 'sans nom' }),
      result('m4', 'UNEXPECTED_FAILURE', { name: 'B' }),
      result('m8', 'UNEXPECTED_FAILURE', { name: 'D' }),
      result('m5', 'UNEXPECTED_FAILURE', { name: 'A', message: 'a' }),
      result('m6', 'UNEXPECTED_FAILURE', { name: 'C' }),
      result('m7', 'UNEXPECTED_FAILURE', { name: 'C' }),
    ]
    for (const r of rows) ctx.writer.saveResult('r1', r as never)
    const s = oracleSuggestions(ctx)
    expect(s.runId).toBe('r1')
    expect(s.items).toEqual([
      { errorName: 'C', count: 2, mutationIds: ['m6', 'm7'], example: '' },
      { errorName: 'A', count: 1, mutationIds: ['m5'], example: 'a' },
      { errorName: 'B', count: 1, mutationIds: ['m4'], example: '' },
      { errorName: 'D', count: 1, mutationIds: ['m8'], example: '' },
    ])
    ctx.close()
  })
})
