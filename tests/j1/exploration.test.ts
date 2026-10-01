// Périmètre J1 déduit de J0-19/J0-20, désormais vérifié avec le produit (CLI) et non plus le spike.
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { newDataDir, varia, withReader } from './helpers.js'

describe('TypeScript (ts-jest, preset) — J0-19', () => {
  it('baseline verte, mutation et classification, piles en lignes .ts', async () => {
    const D = newDataDir()
    const r = await varia(
      ['--data-dir', D, '--json', 'test', '--quick'],
      resolve('examples/ts-project'),
    )
    expect([0, 1]).toContain(r.code)
    const report = JSON.parse(r.out) as {
      mutations: { target: string; path: string; status: string; error: { name: string } | null }[]
      issues: { frame: string | null }[]
    }
    const name = report.mutations
      .filter((m) => m.target === 'src/users.ts#createUser' && m.path === 'arg0.name')
      .map((m) => m.status)
    expect(name).toContain('HANDLED')
    expect(name).toContain('CRASH')
    expect(report.issues.some((i) => /src\/users\.ts:\d+/.test(i.frame ?? ''))).toBe(true)
  })
})

describe('resetModules, isolateModules, mocks, constructeurs — J0-20', () => {
  it('baseline 100 % verte avec la sonde ; séquences conservées ; cibles mockées non observées', async () => {
    const D = newDataDir()
    const r = await varia(['--data-dir', D, 'baseline'], resolve('examples/mocks-project'))
    expect(r.code, r.err).toBe(0)
    withReader(D, (rd) => {
      const id = rd.listRuns(1)[0]?.id ?? ''
      const tests = rd.tests(id)
      expect(tests.every((t) => t.status === 'passed')).toBe(true)
      const sites = (name: string) => {
        const t = tests.find((x) => x.name === name)
        return rd
          .callSites(id)
          .filter((c) => c.testId === t?.testId)
          .map((c) => `${c.export}@${c.depth}#${c.sequence}`)
          .sort()
      }
      expect(sites('après resetModules')).toEqual(['greet@0#0', 'greet@0#1'])
      expect(sites('welcome avec users mocké par fabrique')).toEqual(['welcome@0#0'])
      expect(sites('constructeur ES5')).toEqual(['Counter@0#0'])
    })
  })
})
