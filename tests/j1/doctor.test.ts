// `varia doctor` sur un projet supporté : capacités VÉRIFIÉES par un test de fumée réel (CDC §9.2).
import { describe, expect, it } from 'vitest'
import { json, newDataDir, varia } from './helpers.js'

describe('varia doctor (exemple CommonJS)', () => {
  it('verdict OK, capacités vérifiées et non supportées distinguées', async () => {
    const r = await varia(['--data-dir', newDataDir(), '--json', 'doctor'])
    expect(r.code, r.err).toBe(0)
    const d = json<{ verdict: string; verified: Record<string, string>; reasons: string[] }>(r)
    expect(d.verdict).toBe('OK')
    expect(d.verified).toMatchObject({
      observation: 'VERIFIED',
      argumentMutation: 'VERIFIED',
      perTestSelection: 'VERIFIED',
      asyncTargets: 'VERIFIED',
      cjs: 'VERIFIED',
      isolatedProcess: 'VERIFIED',
      esm: 'UNSUPPORTED',
      mocks: 'UNSUPPORTED',
      testParameters: 'NOT_VERIFIED',
    })
    expect(d.reasons).toContain('TRANSITIVE_CALLS_OBSERVED')
  })
  it('sortie lisible traduite', async () => {
    const r = await varia(['--data-dir', newDataDir(), '--lang', 'en', 'doctor'])
    expect(r.out).toContain('Verdict: OK')
    expect(r.out).toContain('Transitive calls observed')
  })
})
