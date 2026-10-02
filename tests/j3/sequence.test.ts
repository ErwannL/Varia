// A-11 (J0-8, J0-9) : après un TIMEOUT puis un CRASH / PROCESS_EXIT, la mutation SUIVANTE du même run est
// exécutée et classée, et aucun processus du run ne survit (POSIX ; Windows : UNVERIFIED, G-06).
import type { PlannedMutation } from '@varia/core'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { json, newDataDir, varia } from '../j1/helpers.js'

interface Report {
  run: { id: string }
  mutations: { id: string; status: string | null; subtype: string | null }[]
}

describe('une mutation qui boucle ou qui tue le processus n’empêche jamais la suivante', () => {
  it('TIMEOUT, puis PROCESS_EXIT, puis une mutation ordinaire : toutes exécutées et classées', async () => {
    const D = newDataDir()
    expect((await varia(['--data-dir', D, '-q', 'plan', '--out', join(D, 'all.json')])).code).toBe(
      0,
    )
    const all = JSON.parse(readFileSync(join(D, 'all.json'), 'utf8')) as {
      mutations: PlannedMutation[]
    }
    const pick = (exp: string, value: unknown, path?: string) => {
      const m = all.mutations.find(
        (x) =>
          x.export === exp &&
          (path === undefined || x.pathStr === path) &&
          x.op === 'set' &&
          JSON.stringify(x.value) === JSON.stringify(value),
      )
      if (m === undefined) throw new Error(`absente : ${exp}`)
      return m
    }
    // Ordre imposé par un plan importé (`fuzz --plan`) : la boucle, la sortie, puis la suivante.
    const ordered = [
      pick('repeat', null),
      pick('exitOn', 'boom'),
      pick('createUser', null, 'arg0.name'),
    ]
    writeFileSync(join(D, 'seq.json'), JSON.stringify({ ...all, mutations: ordered }))
    const r = await varia(['--data-dir', D, '--json', 'fuzz', '--plan', join(D, 'seq.json')])
    expect([0, 1]).toContain(r.code)
    const report = json<Report>(r)
    const status = (id: string) => report.mutations.find((m) => m.id === id)
    expect(
      [ordered[0], ordered[1], ordered[2]].map((m) => [
        status(m?.id ?? '')?.status,
        status(m?.id ?? '')?.subtype,
      ]),
    ).toEqual([
      ['TIMEOUT', null],
      ['CRASH', 'PROCESS_EXIT'],
      ['HANDLED', null],
    ])
    if (process.platform !== 'win32') {
      // Aucun processus (superviseur, Jest) portant l'identifiant du run ne survit.
      const ps = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' })
      expect(ps.split('\n').filter((l) => l.includes(report.run.id))).toEqual([])
    }
  })
})
