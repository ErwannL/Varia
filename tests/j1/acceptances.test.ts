// J2 : acceptations de bout en bout — `varia accept`, nouveau run, issue ACCEPTED, politique CI.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXAMPLE, json, newDataDir, varia } from './helpers.js'

interface R {
  issues: { id: string; kind: string; target: string; state: string; title: string }[]
  acceptances: { id: string; status: string; matched: number }[]
  mutations: { acceptedBy: string | null }[]
}

describe('acceptations', () => {
  it('une issue acceptée est marquée ACCEPTED (jamais cachée), les autres inchangées ; expirée et obsolète signalées', async () => {
    const D = newDataDir()
    const cfg = join(D, 'cfg.yml')
    writeFileSync(
      cfg,
      readFileSync(join(EXAMPLE, 'varia.yml'), 'utf8') +
        'acceptances:\n  - mutation_pattern: { function: fetchUser }\n    reason: ancien\n    expires: "2020-01-01"\n  - mutation_pattern: { function: ghost }\n    reason: obsolète\n',
    )
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
        '30',
      ])
    await run()
    const first = json<R>(await varia(['--data-dir', D, '--config', cfg, 'report']))
    const echo = first.issues.find((i) => i.kind === 'SUSPICIOUS_ACCEPT')
    expect(echo).toBeDefined()
    const accepted = await varia([
      '--data-dir',
      D,
      '--config',
      cfg,
      'accept',
      echo?.id ?? '',
      '--reason',
      'écho voulu',
      '--owner',
      'équipe',
    ])
    expect(accepted.code, accepted.err).toBe(0)
    await run()
    const second = json<R>(await varia(['--data-dir', D, '--config', cfg, 'report']))
    expect(second.issues.find((i) => i.id === echo?.id)?.state).toBe('ACCEPTED')
    expect(
      second.issues.filter((i) => i.id !== echo?.id).every((i) => i.state !== 'ACCEPTED'),
    ).toBe(true)
    expect(second.acceptances.map((a) => a.status)).toEqual(['EXPIRED', 'OBSOLETE', 'ACTIVE'])
    expect(second.mutations.some((m) => m.acceptedBy !== null)).toBe(true)
    expect((await varia(['--data-dir', D, 'accept', 'i_inconnue', '--reason', 'x'])).code).toBe(2)
  })
})
