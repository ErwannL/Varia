import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProbeEvent } from '@varia/probe-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateAcceptances, type Acceptance } from '../src/acceptances.js'
import type { AdapterRun } from '../src/adapter.js'
import { buildCatalog, fieldsOf } from '../src/catalog.js'
import { runSupervised, statusFileIn } from '../src/exec/proc.js'
import { diffIssues } from '../src/history.js'
import { gitSnapshot, manifestSnapshot } from '../src/integrity.js'
import { firstProjectFrame } from '../src/issues.js'
import { compareBaselines, observationOf } from '../src/observe.js'
import { classify, DEFAULT_ORACLE, findEcho, matchesRule, type OracleInput } from '../src/oracle.js'
import { generatePlan } from '../src/plan.js'
import { candidatesFor, DEFAULT_CONTEXT } from '../src/strategies/index.js'
import { call, input, planOptions } from './fixtures.js'

const dir = () => mkdtempSync(join(tmpdir(), 'varia-cov-'))

describe('acceptations : priorité et expiration', () => {
  it('la première acceptation active couvre la mutation ; une expirée ne couvre rien', () => {
    const acc = (id: string, expires?: string): Acceptance => ({
      id,
      source: 'file',
      function: 'f',
      reason: 'r',
      expires,
    })
    const m = { id: 'm1', module: 'src/a.js', export: 'f', pathStr: 'arg0', strategy: 'type' }
    const r = evaluateAcceptances(
      [acc('old', '2000-01-01'), acc('a1'), acc('a2')],
      [m],
      '2026-01-01',
    )
    expect(r.accepted.get('m1')).toBe('a1')
    expect(r.statuses.map((s) => s.status)).toEqual(['EXPIRED', 'ACTIVE', 'ACTIVE'])
  })
})

describe('catalogue : valeurs non mutables et champs', () => {
  it('une valeur tronquée est cataloguée TRUNCATED', () => {
    const cat = buildCatalog([call({ args: [{ $t: 'truncated' }] })])
    expect(cat.find((d) => d.pathStr === 'arg0')?.reason).toBe('TRUNCATED')
  })
  it('fieldsOf refuse une valeur masquée ou un objet sérialisé sans champs', () => {
    expect(fieldsOf({ $redacted: true, fingerprint: 'h', type: 'string' })).toBeNull()
    expect(fieldsOf({ $t: 'object', v: [1] })).toBeNull()
    expect(fieldsOf({ $t: 'map', v: { a: 1 } })).toBeNull()
    expect(fieldsOf({ $t: 'object', v: { a: 1 } })).toEqual({ a: 1 })
  })
})

describe('comparaison de runs', () => {
  it('plusieurs issues modifiées sont triées par identifiant', () => {
    const a = [
      { id: 'c', target: 't', count: 1 },
      { id: 'a', target: 't', count: 1 },
      { id: 'b', target: 't', count: 1 },
    ]
    const b = [
      { id: 'c', target: 't', count: 2 },
      { id: 'a', target: 't', count: 3 },
      { id: 'b', target: 't', count: 4 },
    ]
    expect(diffIssues(a, b).changed).toEqual([
      { id: 'a', before: 1, after: 3 },
      { id: 'b', before: 1, after: 4 },
      { id: 'c', before: 1, after: 2 },
    ])
  })
})

describe('intégrité', () => {
  it('git : une entrée de statut qui est un répertoire est marquée dir', () => {
    const d = dir()
    execFileSync('git', ['init', '-q'], { cwd: d })
    writeFileSync(join(d, 'f.txt'), 'x')
    execFileSync('git', ['add', 'f.txt'], { cwd: d })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'i'], {
      cwd: d,
    })
    // Un fichier suivi remplacé par un répertoire : git le signale supprimé, le chemin est un dossier.
    rmSync(join(d, 'f.txt'))
    mkdirSync(join(d, 'f.txt'))
    writeFileSync(join(d, 'f.txt', 'g'), 'y')
    const snap = gitSnapshot(d)
    expect([...snap.values()].some((v) => v.endsWith(':dir'))).toBe(true)
  })
  it('manifeste : un lien symbolique n’est ni fichier ni dossier, il est ignoré', () => {
    const d = dir()
    writeFileSync(join(d, 'a.txt'), 'x')
    symlinkSync(join(d, 'a.txt'), join(d, 'lien'))
    expect([...manifestSnapshot(d).keys()]).toEqual(['a.txt'])
  })
})

describe('premier cadre du projet', () => {
  it('cadre anonyme et cadre hors racine', () => {
    expect(firstProjectFrame('    at /p/src/a.js:3:1', '/p')).toBe('<anonymous> (src/a.js:3)')
    expect(firstProjectFrame('    at g (/ailleurs/b.js:7:2)', '/p')).toBe('g (/ailleurs/b.js:7)')
  })
})

describe('observation : champs absents', () => {
  const run = (events: ProbeEvent[]): AdapterRun =>
    ({ events, tests: null, truncatedLines: 0, invalidLines: 0 }) as unknown as AdapterRun
  it('valeurs par défaut quand la sonde omet des champs', () => {
    const o = observationOf(
      run([
        { type: 'TARGET_RETURN', callId: 5 } as ProbeEvent,
        { type: 'OBSERVE_CALL', callSiteId: 's', testId: 't' } as ProbeEvent,
        { type: 'OBSERVE_CALL', callSiteId: 's2', testId: 't', callId: 5 } as ProbeEvent,
      ]),
    )
    expect(o.calls[0]).toMatchObject({
      callId: 0,
      module: '',
      export: '',
      outcome: { kind: 'none', async: false },
    })
    expect(o.calls[1]?.outcome).toEqual({ kind: 'return', async: false })
    expect(o.tests).toEqual([])
  })
  it('un test stable n’est pas signalé, un test instable l’est', () => {
    const obs = (status: 'passed' | 'failed') =>
      observationOf({
        events: [],
        tests: [
          { testId: 'a', name: 'A', status: 'passed' },
          { testId: 'b', name: 'B', status },
        ],
        truncatedLines: 0,
        invalidLines: 0,
      } as unknown as AdapterRun)
    const r = compareBaselines([obs('passed'), obs('failed')])
    expect(r.flaky).toEqual([{ testId: 'b', name: 'B', reasons: ['STATUS_CHANGED'] }])
  })
})

describe('oracle : écho et règles', () => {
  it('findEcho : tableau sans écho, objet sérialisé aux champs non objet', () => {
    expect(findEcho([1, 2], 'x')).toBeNull()
    expect(findEcho({ $t: 'object', v: 5 }, 'x')).toBeNull()
    expect(findEcho([0, { a: 'x' }], 'x')).toBe('return[1].a')
  })
  const e = { name: 'E', message: 'boom', stack: '', constructorChain: ['E'], code: 'C', status: 1 }
  it('matchesRule : chaque critère discordant rejette', () => {
    expect(matchesRule({ name: 'Autre' }, e)).toBe(false)
    expect(matchesRule({ namePattern: '^Z' }, e)).toBe(false)
    expect(matchesRule({ code: 'X' }, e)).toBe(false)
    expect(matchesRule({ status: 2 }, e)).toBe(false)
    expect(matchesRule({ name: 'E', namePattern: '^E', code: 'C', status: 1 }, e)).toBe(true)
  })
  it('un rejet sans erreur sérialisée reste une défaillance inattendue', () => {
    const i = {
      mutation: { strategy: 'type', op: 'set', value: 1 },
      process: { exitCode: 1, signal: null, timedOut: false, stderr: '', outputTruncated: false },
      hello: true,
      reportPresent: true,
      testStatus: 'failed',
      mutateEvents: [{ type: 'MUTATE_CALL', applied: true }],
      mutatedCall: { callId: 1, outcome: { kind: 'reject', async: true } },
    } as unknown as OracleInput
    expect(classify(i, DEFAULT_ORACLE)).toMatchObject({
      status: 'UNEXPECTED_FAILURE',
      outcome: 'reject',
      error: { name: '', message: '' },
    })
  })
})

describe('plan : test inconnu', () => {
  it('fichier et nom de test vides si le test n’est pas répertorié', () => {
    const p = generatePlan([input('x', 'string', { testId: 'inconnu' })], planOptions())
    expect(p.mutations.length).toBeGreaterThan(0)
    expect(p.mutations.every((m) => m.testFile === '' && m.testName === '')).toBe(true)
  })
})

describe('stratégies : cas limites', () => {
  const values = (original: unknown, type: string, strategy: string, over = {}) =>
    candidatesFor(input(original as never, type, over), [strategy], DEFAULT_CONTEXT).map((c) =>
      c.op === 'delete' ? '<delete>' : c.value,
    )
  it('tableau vide : élément de remplacement 1', () => {
    expect(values([], 'array', 'size')[0]).toEqual(new Array(DEFAULT_CONTEXT.arrayLength).fill(1))
  })
  it('nombre dont l’original n’est pas un nombre : chaîne "0"', () => {
    expect(values({ $t: 'number', v: 'NaN' }, 'number', 'type')[0]).toBe('0')
  })
  it('borne de chaîne à 0 : pas de longueur négative', () => {
    const v = values('ab', 'string', 'boundary', {
      bounds: { min: 0, max: 2, provenance: 'observed' },
    })
    expect(v).toContain('aaa')
    expect(v.filter((x) => typeof x === 'string' && x.length > 3)).toEqual([])
  })
  it('structure sur un original sans champs : copies minimales', () => {
    const v = values({ $redacted: true, fingerprint: 'h', type: 'object' }, 'object', 'structure')
    expect(v[0]).toEqual({ __varia_extra__: 'unexpected' })
    expect(v).toHaveLength(3)
    expect(values({ k: 2 }, 'object', 'structure')).toContainEqual({ k: [2] })
  })
})

describe('exécution : filet de sécurité de l’orchestrateur', () => {
  afterEach(() => vi.useRealTimers())
  it('si le superviseur ne rend pas la main, l’arbre est tué et le run marqué timedOut', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const d = dir()
    const p = runSupervised(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: d,
      env: process.env,
      timeoutMs: 600000,
      statusFile: statusFileIn(d),
    })
    vi.advanceTimersByTime(605000)
    const r = await p
    expect(r.timedOut).toBe(true)
    expect(r.signal ?? r.exitCode).not.toBe(0)
  })
  it('échec de lancement avant l’échéance : pas de pid, rien à tuer, rejet', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const p = runSupervised(process.execPath, [], {
      cwd: join(dir(), 'absent'),
      env: process.env,
      timeoutMs: 1,
      statusFile: join(dir(), 's.json'),
    })
    expect(() => vi.advanceTimersByTime(10000)).not.toThrow()
    await expect(p).rejects.toThrow(/ENOENT/)
  })
})
