// S-01 : la matrice de compatibilité documentée (docs/adapter-capabilities.md) est celle que mesure
// RÉELLEMENT `doctor` sur les projets d'exemple. Une seule passe de doctor par adaptateur (beforeAll),
// puis comparaison octet pour octet avec le fichier versionné ; un adaptateur non mesuré fait échouer.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { DoctorReport } from '@varia/engine'
import { ADAPTERS } from '../../packages/cli/src/commands/admin.js'
import {
  DOC,
  formatDoc,
  measure,
  measureAll,
  render,
  rowOf,
  run,
  type Row,
} from '../../scripts/write-capabilities.js'

describe('matrice mesurée (doctor réel sur chaque projet d’exemple)', () => {
  let rows: Row[] = []
  beforeAll(async () => {
    rows = await measureAll()
  }, 600_000)

  it('chaque adaptateur est mesuré (aucun outil absent)', () => {
    expect(rows.map((r) => r.adapter)).toEqual([...ADAPTERS])
    expect(rows.filter((r) => !r.measured)).toEqual([])
  })

  it('docs/adapter-capabilities.md est identique à la matrice mesurée', async () => {
    expect(readFileSync(DOC, 'utf8')).toBe(await formatDoc(render(rows)))
  })

  it('run --check : 0 sur le fichier versionné, 1 sur un fichier modifié à la main', async () => {
    const log: string[] = []
    expect(await run(rows, { check: true, file: DOC, log: (l) => log.push(l) })).toBe(0)
    const edited = join(mkdtempSync(join(tmpdir(), 'varia-caps-')), 'caps.md')
    writeFileSync(edited, readFileSync(DOC, 'utf8').replace('oui / VERIFIED', 'oui / UNSUPPORTED'))
    expect(await run(rows, { check: true, file: edited, log: (l) => log.push(l) })).toBe(1)
    expect(log.at(-1)).toContain('diverge')
  })
})

const report = (verdict: DoctorReport['verdict']): DoctorReport =>
  ({
    node: 'v0',
    adapter: 'x',
    adapterVersion: null,
    detected: verdict !== 'RUNNER_NOT_FOUND',
    nativeEsm: false,
    reasons: ['B', 'A', 'B'],
    verdict,
    declared: { observation: true, cjs: false },
    verified: { observation: 'VERIFIED', cjs: 'UNSUPPORTED' },
    checks: {
      observation: { status: 'VERIFIED', reason: null },
      cjs: { status: 'UNSUPPORTED', reason: 'UNKNOWN_CODE' },
    },
  }) as unknown as DoctorReport

describe('rendu (jamais de valeur inventée)', () => {
  it('lanceur introuvable ⇒ « non mesuré : outil absent », exit 1 en écriture comme en check', async () => {
    const r = rowOf('pytest', 'examples/pytest-project', report('RUNNER_NOT_FOUND'))
    expect(r).toEqual({
      adapter: 'pytest',
      example: 'examples/pytest-project',
      measured: false,
      why: 'RUNNER_NOT_FOUND',
    })
    const ok = rowOf('jest', 'examples/jest-project', report('OK'))
    const md = render([ok, r, { adapter: 'z', example: 'e', measured: false, why: 'ERROR:X' }])
    expect(md).toContain('**non mesuré : outil absent')
    expect(md).toContain('**non mesuré : ERROR:X**')
    // Version inconnue, constats dédoublonnés et triés, code de raison sans traduction gardé tel quel.
    expect(md).toContain('| jest | `examples/jest-project` | ? | OK | A, B |')
    expect(md).toContain('| cjs | non / UNSUPPORTED (UNKNOWN_CODE) | non mesuré | non mesuré |')
    expect(md).toContain('| `UNKNOWN_CODE` | UNKNOWN_CODE |')
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    // Capacités triées par nom, quel que soit l'ordre de doctor (observation avant cjs ici).
    expect(md.indexOf('| cjs |')).toBeLessThan(md.indexOf('| observation |'))
    const file = join(mkdtempSync(join(tmpdir(), 'varia-caps-')), 'caps.md')
    const log: string[] = []
    expect(await run([ok, r], { check: false, file, log: (l) => log.push(l) })).toBe(1)
    expect(readFileSync(file, 'utf8')).toContain('non mesuré')
    expect(await run([ok, r], { check: true, file, log: (l) => log.push(l) })).toBe(1)
    expect(log).toContain('non mesuré : pytest (RUNNER_NOT_FOUND)')
    expect(await run([ok], { check: true, file: join(file, 'absent'), log: () => undefined })).toBe(
      1,
    )
  })

  it('capacité absente d’un adaptateur ⇒ « — » ; adaptateur sans projet ⇒ non mesuré', async () => {
    const a = rowOf('a', 'ea', report('OK'))
    const b = {
      ...a,
      adapter: 'b',
      caps: a.measured ? a.caps.filter((c) => c.name === 'observation') : [],
    } as Row
    expect(render([a, b])).toMatch(/\| observation \| oui \/ VERIFIED \| oui \/ VERIFIED \|/)
    expect(render([a, b])).toMatch(/\| cjs \| [^|]+\| — \|/)
    const none = await measure('inexistant')
    expect(none.measured).toBe(false)
    expect(none.measured ? '' : none.why).toMatch(/^(ERROR|ADAPTER_MISMATCH)/)
  })
})
