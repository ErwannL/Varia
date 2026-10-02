// J2 : historique — deux runs réels sur l'exemple, états d'issues, `varia compare`, diff de l'API.
import { buildServer } from '@varia/api'
import { describe, expect, it } from 'vitest'
import { deterministicConfig, json, newDataDir, projectDir, varia, withReader } from './helpers.js'

describe('historique et comparaison', () => {
  it('second run : états calculés, compare et /diff', async () => {
    const D = newDataDir()
    // F-02 : cibles déterministes et rapides (aucun timeout), délai explicite large.
    const cfg = deterministicConfig()
    for (let i = 0; i < 2; i++)
      expect([1, 0]).toContain(
        (
          await varia([
            '--data-dir',
            D,
            '--config',
            cfg,
            '-q',
            'test',
            '--quick',
            '--seed',
            '42',
            '--max-mutations',
            '10',
          ])
        ).code,
      )
    const [second, first] = withReader(D, (r) => r.listRuns(2).map((x) => x.id))
    const states = withReader(D, (r) => ({ a: r.issues(first ?? ''), b: r.issues(second ?? '') }))
    expect(states.a.every((i) => i.state === 'NEW')).toBe(true)
    expect(states.b.length).toBeGreaterThan(0)
    expect(states.b.every((i) => i.state === 'UNCHANGED')).toBe(true)
    const report = json<{ comparedTo: string; resolvedIssues: unknown[] }>(
      await varia(['--data-dir', D, '--config', cfg, 'report', second ?? '']),
    )
    expect(report.comparedTo).toBe(first)
    expect(report.resolvedIssues).toEqual([])
    const cmp = json<{ added: string[]; removed: string[]; unchanged: string[] }>(
      await varia([
        '--data-dir',
        D,
        '--config',
        cfg,
        '--json',
        'compare',
        first ?? '',
        second ?? '',
      ]),
    )
    expect([cmp.added, cmp.removed, cmp.unchanged.length]).toEqual([[], [], states.b.length])
    const human = await varia([
      '--data-dir',
      D,
      '--config',
      cfg,
      '--lang',
      'en',
      'compare',
      first ?? '',
      second ?? '',
    ])
    expect(human.out).toContain(`0 new · 0 gone · 0 changed · ${String(states.b.length)} unchanged`)
    expect(
      (await varia(['--data-dir', D, '--config', cfg, 'compare', 'r_x', second ?? ''])).code,
    ).toBe(2)
    const { app } = buildServer({ dataDir: projectDir(D), env: {}, dashboardDir: '/none' })
    const diff = (await app.inject({ url: `/api/v1/runs/${second ?? ''}/diff` })).json() as {
      against: string
      diff: { unchanged: string[] }
    }
    expect(diff.against).toBe(first)
    expect(diff.diff.unchanged).toHaveLength(states.b.length)
    expect((await app.inject({ url: '/api/v1/runs/r_x/diff' })).statusCode).toBe(404)
    await app.close()
  })
})
