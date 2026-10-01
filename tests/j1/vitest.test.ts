// J2 : adapter Vitest via le vrai CLI — ESM natif + TypeScript, mêmes classifications que sous Jest.
import { diffSnapshots, gitSnapshot, manifestSnapshot } from '@varia/core'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { json, newDataDir, varia } from './helpers.js'

const ROOT = resolve('examples/vitest-project')

describe('Vitest (ESM natif, TypeScript)', () => {
  it('doctor : ESM vérifié', async () => {
    const d = json<{ verdict: string; adapter: string; verified: Record<string, string> }>(
      await varia(['--data-dir', newDataDir(), '--json', 'doctor'], ROOT),
    )
    expect(d.adapter).toBe('vitest')
    expect(d.verdict).toBe('OK')
    expect(d.verified).toMatchObject({
      observation: 'VERIFIED',
      argumentMutation: 'VERIFIED',
      perTestSelection: 'VERIFIED',
      esm: 'VERIFIED',
    })
  })
  it('varia test : HANDLED / CRASH / ECHO, appel interne non observé, projet intact', async () => {
    const before = { git: gitSnapshot(ROOT), manifest: manifestSnapshot(ROOT) }
    const D = newDataDir()
    const r = await varia(['--data-dir', D, '--json', 'test', '--quick', '--seed', '9'], ROOT)
    expect(r.code, r.err).toBe(1)
    const rep = JSON.parse(r.out) as {
      mutations: {
        target: string
        path: string
        status: string
        subtype: string | null
        value: unknown
      }[]
      notCovered: { neverCalled: string[] }
      limitations: string[]
    }
    const name = (v: unknown) =>
      rep.mutations.find(
        (m) =>
          m.target === 'src/users.ts#createUser' &&
          m.path === 'arg0.name' &&
          JSON.stringify(m.value) === JSON.stringify(v),
      )?.status
    expect(name(null)).toBe('HANDLED')
    const typeOnName = rep.mutations.filter(
      (m) =>
        m.target === 'src/users.ts#createUser' &&
        m.path === 'arg0.name' &&
        typeof m.value !== 'string' &&
        m.value !== null,
    )
    expect(typeOnName.length).toBeGreaterThan(0)
    expect(typeOnName.map((m) => m.status)).toContain('CRASH')
    expect(
      rep.mutations.some(
        (m) => m.target === 'src/users.ts#echoValue' && m.subtype === 'SUSPICIOUS_ACCEPT',
      ),
    ).toBe(true)
    expect(rep.notCovered.neverCalled).toContain('src/users.ts#helper')
    expect(rep.limitations).not.toContain('NATIVE_ESM_UNSUPPORTED')
    expect(diffSnapshots(before.git, gitSnapshot(ROOT))).toEqual([])
    expect(diffSnapshots(before.manifest, manifestSnapshot(ROOT))).toEqual([])
  })
})
