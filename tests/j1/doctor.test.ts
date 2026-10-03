// `varia doctor` sur un projet supporté : capacités VÉRIFIÉES par un test de fumée réel (CDC §9.2).
import { describe, expect, it } from 'vitest'
import { json, newDataDir, varia } from './helpers.js'

describe('varia doctor (exemple CommonJS)', () => {
  it('verdict OK, capacités vérifiées et non supportées distinguées', async () => {
    const r = await varia(['--data-dir', newDataDir(), '--json', 'doctor'])
    expect(r.code, r.err).toBe(0)
    const d = json<{
      verdict: string
      verified: Record<string, string>
      checks: Record<string, { status: string; reason: string | null }>
      reasons: string[]
    }>(r)
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
      coverage: 'VERIFIED',
      parallelSafe: 'UNSUPPORTED',
    })
    // D-01 : raison explicite de tout ce qui n'est pas VERIFIED.
    expect(d.checks.testParameters).toEqual({ status: 'NOT_VERIFIED', reason: 'NO_SMOKE_TEST' })
    expect(d.checks.esm).toEqual({ status: 'UNSUPPORTED', reason: 'NOT_DECLARED' })
    expect(d.checks.isolatedProcess).toEqual({ status: 'VERIFIED', reason: null })
    expect(d.reasons).toContain('TRANSITIVE_CALLS_OBSERVED')
  })
  it('sortie lisible traduite', async () => {
    const r = await varia(['--data-dir', newDataDir(), '--lang', 'en', 'doctor'])
    expect(r.out).toContain('Verdict: OK')
    expect(r.out).toContain('Transitive calls observed')
    // D-01 : la raison de ce qui n'est pas vérifié est affichée, traduite ; rien pour VERIFIED.
    expect(r.out).toMatch(/^ {2}testParameters: NOT_VERIFIED — \S/m)
    expect(r.out).toMatch(/^ {2}isolatedProcess: VERIFIED$/m)
  })
})
