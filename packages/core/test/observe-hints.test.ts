import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { testNodeOptions, type AdapterRun } from '../src/adapter.js'
import { detectFormat, violatesHint } from '../src/hints.js'
import { diffSnapshots, gitSnapshot } from '../src/integrity.js'
import { compareBaselines, observationOf, type Observation } from '../src/observe.js'
import { call } from './fixtures.js'

const ev = (o: Record<string, unknown>) =>
  ({
    protocolVersion: 1 as const,
    runId: 'r',
    testId: 't_1',
    timestamp: 't',
    ...o,
  }) as AdapterRun['events'][number]
const run = (events: AdapterRun['events']): AdapterRun => ({
  process: {
    exitCode: 0,
    signal: null,
    timedOut: false,
    durationMs: 1,
    stdout: '',
    stderr: '',
    outputTruncated: false,
    pid: 1,
  },
  tests: null,
  events,
  truncatedLines: 2,
  invalidLines: 1,
})

describe('formats et contrats déclarés (CDC §12.3, §18.4)', () => {
  it.each([
    ['a@b.co', 'email'],
    ['123e4567-e89b-12d3-a456-426614174000', 'uuid'],
    ['https://x.dev/a', 'url'],
    ['2024-01-31', 'iso-date'],
    ['2024-01-31T10:20:30.5Z', 'iso-date'],
    ['10.0.0.1', 'ipv4'],
    ['hello', undefined],
  ])('detectFormat(%s)', (v, f) => expect(detectFormat(v)).toBe(f))
  it('range', () => {
    const h = { path: 'f#arg0', range: [0, 10] as [number, number] }
    expect([
      violatesHint(h, 5),
      violatesHint(h, 11),
      violatesHint(h, -1),
      // A-13 : un autre type n'est pas une violation de `range` (le contrat ne s'applique pas).
      violatesHint(h, '5'),
    ]).toEqual([false, true, true, false])
  })
  it('format', () => {
    const h = { path: 'f#arg0', format: 'email' as const }
    expect([violatesHint(h, 'a@b.co'), violatesHint(h, 'nope'), violatesHint(h, 3)]).toEqual([
      false,
      true,
      false,
    ])
  })
  it('length (chaîne et tableau)', () => {
    const h = { path: 'f#arg0', length: [1, 3] as [number, number] }
    expect([
      violatesHint(h, 'ab'),
      violatesHint(h, ''),
      violatesHint(h, [1, 2, 3, 4]),
      violatesHint(h, [1]),
      violatesHint(h, 7),
    ]).toEqual([false, true, true, false, false])
  })
  it('hint sans contrainte', () => expect(violatesHint({ path: 'f#arg0' }, 1)).toBe(false))
})

describe('observation', () => {
  it('reconstitue appels, issues, découvertes, HELLO, lignes tronquées', () => {
    const o = observationOf(
      run([
        ev({ type: 'HELLO' }),
        ev({ type: 'DISCOVER', module: 'm', wrapped: ['f'] }),
        ev({ type: 'DISCOVER', module: 'n' }),
        ev({
          type: 'OBSERVE_CALL',
          callId: 1,
          callSiteId: 'c1',
          module: 'm',
          export: 'f',
          depth: 0,
          sequence: 0,
          argsFingerprint: 'a',
          args: [1],
        }),
        ev({ type: 'TARGET_RETURN', callId: 1, async: true, value: 2 }),
        ev({
          type: 'OBSERVE_CALL',
          callId: 2,
          callSiteId: 'c2',
          module: 'm',
          export: 'f',
          depth: 0,
          sequence: 1,
          argsFingerprint: 'b',
          mutated: true,
        }),
        ev({
          type: 'TARGET_THROW',
          callId: 2,
          error: { name: 'E', message: 'm', stack: '', constructorChain: [] },
        }),
        ev({ type: 'OBSERVE_CALL', callId: 3, callSiteId: 'c3', module: 'm', export: 'f' }),
        ev({ type: 'TARGET_REJECT', callId: 3 }),
        ev({ type: 'OBSERVE_CALL', callId: 4, callSiteId: 'c4', module: 'm', export: 'f' }),
        ev({ type: 'OBSERVE_CALL', callId: 5, callSiteId: null }),
        ev({ type: 'MUTATE_CALL', callId: 2, applied: true }),
        ev({ type: 'TARGET_RETURN' }),
      ]),
    )
    expect(o.calls.map((c) => [c.callSiteId, c.outcome.kind, c.outcome.async, c.mutated])).toEqual([
      ['c1', 'return', true, false],
      ['c2', 'throw', false, true],
      ['c3', 'reject', true, false],
      ['c4', 'none', false, false],
    ])
    expect(o.discovered).toEqual({
      m: { wrapped: ['f'], unsupported: [] },
      n: { wrapped: [], unsupported: [] },
    })
    expect([
      o.helloCount,
      o.mutateEvents.length,
      o.truncatedLines,
      o.invalidLines,
      o.tests,
    ]).toEqual([1, 1, 2, 1, []])
  })
  it('stabilité : statut changé, call site disparu, empreinte différente, aucune baseline', () => {
    const test = (status: 'passed' | 'failed') => ({
      testId: 't_1',
      file: 'f',
      name: 'n',
      status,
      durationMs: null,
    })
    const base: Observation = {
      tests: [test('passed')],
      calls: [call()],
      discovered: {},
      mutateEvents: [],
      helloCount: 1,
      truncatedLines: 0,
      invalidLines: 0,
    }
    expect(
      compareBaselines([base, { ...base, tests: [test('failed')] }]).flaky[0]?.reasons,
    ).toEqual(['STATUS_CHANGED'])
    expect(compareBaselines([base, { ...base, calls: [] }]).flaky[0]?.reasons).toEqual([
      'CALL_SITES_CHANGED',
    ])
    const nd = compareBaselines([base, { ...base, calls: [call({ argsFingerprint: 'other' })] }])
    expect([nd.flaky[0]?.reasons, nd.nonDeterministicCallSites]).toEqual([
      ['NON_DETERMINISTIC_INPUT'],
      ['c_1'],
    ])
    expect(compareBaselines([base, base]).flaky).toEqual([])
    expect(compareBaselines([])).toEqual({ flaky: [], nonDeterministicCallSites: [] })
  })
})

describe('résumé de couverture istanbul', () => {
  it('pourcentages par fichier, « Unknown » compté 100, total ignoré', async () => {
    const { parseCoverageSummary } = await import('../src/adapter.js')
    const json = JSON.stringify({
      total: { lines: { pct: 50 } },
      '/p/src/b.js': {
        lines: { pct: 80 },
        statements: { pct: 81 },
        functions: { pct: 'Unknown' },
        branches: { pct: 50 },
      },
      '/p/src/a.js': {
        lines: { pct: 100 },
        statements: { pct: 100 },
        functions: { pct: 100 },
        branches: { pct: 100 },
      },
    })
    expect(parseCoverageSummary(json, '/p', (f) => f.replace('/p/', ''))).toEqual([
      { file: 'src/a.js', lines: 100, statements: 100, functions: 100, branches: 100 },
      { file: 'src/b.js', lines: 80, statements: 81, functions: 100, branches: 50 },
    ])
  })
})

describe('intégrité avec git (CDC §5)', () => {
  it('fichiers modifiés, ajoutés, supprimés', () => {
    const d = mkdtempSync(join(tmpdir(), 'varia-git-'))
    const git = (...a: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: d })
    git('init', '-q')
    writeFileSync(join(d, 'a.txt'), 'a')
    writeFileSync(join(d, 'b.txt'), 'b')
    git('add', '.')
    git('commit', '-qm', 'init')
    const before = gitSnapshot(d)
    writeFileSync(join(d, 'a.txt'), 'changed')
    rmSync(join(d, 'b.txt'))
    writeFileSync(join(d, 'c.txt'), 'new')
    const after = gitSnapshot(d)
    expect(diffSnapshots(before, after)).toEqual(['a.txt', 'b.txt', 'c.txt'])
    expect(after.get('b.txt')).toMatch(/missing$/)
  })
})

describe('options Node des processus de test (A-03)', () => {
  it('héritées, du projet, puis limite de mémoire', () => {
    expect(testNodeOptions(undefined, {})).toBeUndefined()
    expect(testNodeOptions(' ', { nodeOptions: '' })).toBeUndefined()
    expect(testNodeOptions('--a', { nodeOptions: '--b', memoryMb: 128 })).toBe(
      '--a --b --max-old-space-size=128',
    )
    expect(testNodeOptions(undefined, { memoryMb: 64 })).toBe('--max-old-space-size=64')
  })
})
