// Acceptation J1 (CDC §45) : 2 issues attendues, 4 doctor ESM, 5 reprise après arrêt brutal.
import { openReader, Reader } from '@varia/database'
import { reportSchema, type Report } from '@varia/reporters'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXAMPLE, json, newDataDir, projectDir, varia, withReader } from './helpers.js'

describe('J1-2 : `varia test` sur l’exemple', () => {
  it('issues attendues, aucune validation correcte classée en crash, rapport valide', async () => {
    const D = newDataDir()
    const r = await varia(['--data-dir', D, 'test', '--quick'])
    expect(r.code, r.err).toBe(1)
    expect(r.err).toContain('Varia par Orqea · v0.1.0')
    const out = join(D, 'report.json')
    expect((await varia(['--data-dir', D, '-q', 'report', '--out', out])).code).toBe(0)
    const report = JSON.parse(readFileSync(out, 'utf8')) as Report
    expect(reportSchema.safeParse(report).success).toBe(true)
    const issue = (pred: (i: Report['issues'][number]) => boolean) => report.issues.filter(pred)
    const trim = issue(
      (i) =>
        i.target === 'src/users.js#createUser' &&
        i.errorName === 'TypeError' &&
        i.title.includes('trim is not a function'),
    )
    expect(trim).toHaveLength(1)
    const trimMutations = report.mutations.filter((m) =>
      m.error?.message.includes('trim is not a function'),
    )
    expect(trimMutations.length).toBeGreaterThan(1)
    expect(new Set(trim[0]?.mutationIds)).toEqual(new Set(trimMutations.map((m) => m.id)))
    expect(issue((i) => i.target === 'src/values.js#repeat' && i.kind === 'TIMEOUT')).toHaveLength(
      1,
    )
    expect(
      issue((i) => i.target === 'src/values.js#exitOn' && i.kind === 'PROCESS_EXIT'),
    ).toHaveLength(1)
    expect(
      issue(
        (i) =>
          i.target === 'src/values.js#echoValue' &&
          i.kind === 'SUSPICIOUS_ACCEPT' &&
          i.title.includes('ECHO'),
      ),
    ).toHaveLength(1)
    for (const m of report.mutations.filter((x) => x.error?.name === 'ValidationError'))
      expect(m.status, m.id).toBe('HANDLED')
    expect(
      report.mutations
        .filter(
          (m) =>
            m.target === 'src/users.js#createUser' && m.path === 'arg0.name' && m.value === null,
        )
        .map((m) => m.status),
    ).toContain('HANDLED')
    expect(report.counts.pending).toBe(0)
    expect(report.notCovered.neverCalled).toContain('src/math.js#helper')
    // Exemple complet (baseline + fuzz rapide) : jusqu'à 5 min sur un runner Windows chargé.
  }, 300_000)
})

describe('J1-4 : `varia doctor` sur un projet ESM natif', () => {
  it('répond UNSUPPORTED_PROBE (code 5), clairement', async () => {
    const r = await varia(
      ['--data-dir', newDataDir(), '--json', 'doctor'],
      resolve('examples/esm-project'),
    )
    expect(r.code).toBe(5)
    expect(json<{ verdict: string; reasons: string[] }>(r)).toMatchObject({
      verdict: 'UNSUPPORTED_PROBE',
      reasons: ['NATIVE_ESM'],
    })
    const human = await varia(
      ['--data-dir', newDataDir(), 'doctor'],
      resolve('examples/esm-project'),
    )
    expect(human.out).toContain('Verdict : UNSUPPORTED_PROBE')
    expect(human.out).toContain('ESM natif')
  })
  it('et `varia baseline` refuse avec le même code', async () => {
    const r = await varia(['--data-dir', newDataDir(), 'baseline'], resolve('examples/esm-project'))
    expect(r.code).toBe(5)
    expect(r.err).toContain('UNSUPPORTED_PROBE')
  })
})

describe('J1-5 : reprise après arrêt brutal du processus Varia', () => {
  it('`varia fuzz --resume` ne rejoue aucune mutation déjà persistée', async () => {
    const bin = resolve('bin/varia')
    expect(
      existsSync(resolve('packages/cli/dist/main.js')),
      'lancer `npm run build` avant les tests',
    ).toBe(true)
    const D = newDataDir()
    expect((await varia(['--data-dir', D, '-q', 'baseline'])).code).toBe(0)
    expect((await varia(['--data-dir', D, '-q', 'plan', '--max-mutations', '12'])).code).toBe(0)
    const dbPath = join(projectDir(D), 'varia.db')
    const runId = withReader(D, (r) => r.listRuns(1)[0]?.id ?? '')
    const child = spawn(process.execPath, [bin, '--data-dir', D, '-q', 'fuzz'], {
      cwd: EXAMPLE,
      stdio: 'ignore',
    })
    const persisted = await new Promise<Set<string>>((done, fail) => {
      const started = Date.now()
      const timer = setInterval(() => {
        const o = openReader(dbPath)
        const ids = new Reader(o.db).resultIds(runId)
        o.close()
        if (ids.size >= 3) {
          clearInterval(timer)
          child.kill('SIGKILL')
          done(ids)
        } else if (Date.now() - started > 90_000) {
          clearInterval(timer)
          child.kill('SIGKILL')
          fail(new Error('aucun résultat persisté'))
        }
      }, 50)
    })
    await new Promise((r) => child.once('exit', r))
    const before = withReader(D, (r) => r.resultIds(runId))
    expect(before.size).toBeGreaterThanOrEqual(persisted.size)
    expect(before.size).toBeLessThan(12)
    const resumed = await varia(['--data-dir', D, '-q', 'fuzz', '--resume', runId])
    expect([0, 1]).toContain(resumed.code)
    withReader(D, (r) => {
      const started = r
        .events(runId, 'MUTATION_STARTED')
        .map((e) => e.data as { mutationId: string; invocation: string })
      const second = started.filter((e) => e.invocation === '2').map((e) => e.mutationId)
      for (const id of before) expect(second, id).not.toContain(id)
      expect(second.length).toBe(12 - before.size)
      expect(r.resultIds(runId).size).toBe(12)
      expect(r.getRun(runId)?.state).toBe('COMPLETED')
    })
  })
})
