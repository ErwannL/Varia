// J2 / B-06 : acceptations de bout en bout selon `acceptances.store` — base (`varia accept`) ou fichier
// (`varia.yml`, forme abrégée) ; une issue acceptée est marquée ACCEPTED, jamais cachée.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deterministicConfig, json, newDataDir, varia } from './helpers.js'

interface R {
  issues: { id: string; kind: string; target: string; state: string; title: string }[]
  acceptances: { id: string; source: string; status: string; matched: number }[]
  mutations: { acceptedBy: string | null }[]
}

const cycle = (D: string, cfg: string) => {
  const run = () =>
    varia([
      '--data-dir',
      D,
      '--config',
      cfg,
      '-q',
      'test',
      '--quick',
      '--seed',
      '5',
      '--max-mutations',
      '10',
    ])
  const report = async () => json<R>(await varia(['--data-dir', D, '--config', cfg, 'report']))
  return { run, report }
}

describe('acceptations (CDC §21, B-06)', () => {
  it('store: db (défaut) — `varia accept` écrit en base, issue ACCEPTED au run suivant', async () => {
    const D = newDataDir()
    const cfg = deterministicConfig()
    const { run, report } = cycle(D, cfg)
    await run()
    const crash = (await report()).issues.find((i) => i.kind === 'ERROR')
    expect(crash).toBeDefined()
    const accepted = await varia([
      '--data-dir',
      D,
      '--config',
      cfg,
      'accept',
      crash?.id ?? '',
      '--reason',
      'voulu',
      '--owner',
      'équipe',
    ])
    expect(accepted.code, accepted.err).toBe(0)
    await run()
    const second = await report()
    expect(second.issues.find((i) => i.id === crash?.id)?.state).toBe('ACCEPTED')
    expect(
      second.issues.filter((i) => i.id !== crash?.id).every((i) => i.state !== 'ACCEPTED'),
    ).toBe(true)
    expect(second.acceptances.map((a) => [a.source, a.status])).toEqual([['db', 'ACTIVE']])
    expect(second.mutations.some((m) => m.acceptedBy !== null)).toBe(true)
    expect(
      (await varia(['--data-dir', D, '--config', cfg, 'accept', 'i_inconnue', '--reason', 'x']))
        .code,
    ).toBe(2)
  })
  it('store: file (forme abrégée) — seules les entrées de varia.yml comptent ; `accept` donne l’entrée à ajouter', async () => {
    const D = newDataDir()
    const cfg = deterministicConfig([
      'acceptances:',
      '  - mutation_pattern: { function: createUser }',
      '    reason: voulu',
      '  - mutation_pattern: { function: fetchUser }',
      '    reason: ancien',
      '    expires: "2020-01-01"',
      '  - mutation_pattern: { function: ghost }',
      '    reason: obsolète',
    ])
    const { run, report } = cycle(D, cfg)
    await run()
    const first = await report()
    expect(first.acceptances.map((a) => [a.source, a.status])).toEqual([
      ['file', 'ACTIVE'],
      ['file', 'EXPIRED'],
      ['file', 'OBSOLETE'],
    ])
    expect(
      first.issues
        .filter((i) => i.target.endsWith('#createUser'))
        .every((i) => i.state === 'ACCEPTED'),
    ).toBe(true)
    const other = first.issues[0]
    expect(other).toBeDefined()
    const printed = await varia([
      '--data-dir',
      D,
      '--config',
      cfg,
      'accept',
      other?.id ?? '',
      '--reason',
      'x',
    ])
    expect(printed.code).toBe(0)
    expect(printed.out).toContain(`"mutation_pattern":{"function":"${other?.target ?? ''}"`)
    await run()
    // Rien n'a été écrit en base : les acceptations restent celles du fichier.
    expect((await report()).acceptances.map((a) => a.source)).toEqual(['file', 'file', 'file'])
  })
  it('store: db avec des items ⇒ configuration refusée (exit 3)', async () => {
    const cfg = join(newDataDir(), 'v.yml')
    writeFileSync(
      cfg,
      'version: 1\nacceptances: { store: db, items: [{ mutation_pattern: { function: f }, reason: r }] }\n',
    )
    const r = await varia(['--config', cfg, 'config', '--check'])
    expect(r.code).toBe(3)
    expect(r.err).toContain('acceptances.items')
  })
})
