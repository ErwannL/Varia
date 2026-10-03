// A-03 : `memory_mb` est réellement appliqué (--max-old-space-size) et son dépassement est un CRASH /
// RESOURCE_LIMIT ; le dépassement de `max_output_bytes` aussi (l'arbre est arrêté).
import type { PlannedMutation } from '@varia/core'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { json, newDataDir, varia } from '../j1/helpers.js'

export const LIMITS = resolve('examples/limits-project')

/** Configuration hors du projet (`varia --config`), jamais écrite dans le projet. */
export function limitsConfig(extra = ''): string {
  const file = join(mkdtempSync(join(tmpdir(), 'varia-cfg-')), 'varia.yml')
  writeFileSync(
    file,
    [
      'version: 1',
      'targets: { mode: auto, include: ["src/**"] }',
      'mutations: { mode: normal, seed: 3, per_input: 40, limits: { memory_mb: 128 } }',
      'execution: { timeout_ms: 30000, max_output_bytes: 4194304 }',
      extra,
    ].join('\n'),
  )
  return file
}

const D = newDataDir()
const CFG = limitsConfig()
let plan: { mutations: PlannedMutation[] }
const cli = (args: string[]) => varia(['--data-dir', D, '--config', CFG, ...args], LIMITS)

beforeAll(async () => {
  const b = await cli(['baseline'])
  expect(b.code, b.err).toBe(0)
  const p = await cli(['-q', 'plan', '--out', join(D, 'plan.json')])
  expect(p.code, p.err).toBe(0)
  plan = JSON.parse(readFileSync(join(D, 'plan.json'), 'utf8')) as typeof plan
})

const replay = async (exp: string, value: unknown) => {
  const m = plan.mutations.find(
    (x) => x.export === exp && x.op === 'set' && JSON.stringify(x.value) === JSON.stringify(value),
  )
  if (m === undefined) throw new Error(`mutation absente : ${exp} ${JSON.stringify(value)}`)
  const r = await cli(['--json', 'replay', m.id])
  expect(r.code, r.err).toBe(0)
  return json<{ classification: { status: string; subtype?: string; reason?: string } }>(r)
    .classification
}

describe('limites de ressources réelles (A-03)', () => {
  it('grow(null) épuise un tas limité à 128 Mo ⇒ CRASH / RESOURCE_LIMIT (OUT_OF_MEMORY)', async () => {
    const c = await replay('grow', null)
    expect([c.status, c.subtype, c.reason]).toEqual(['CRASH', 'RESOURCE_LIMIT', 'OUT_OF_MEMORY'])
  })
  it('shout(MAX_SAFE_INTEGER) dépasse 4 Mo de sortie ⇒ CRASH / RESOURCE_LIMIT (OUTPUT_LIMIT)', async () => {
    const c = await replay('shout', Number.MAX_SAFE_INTEGER)
    expect([c.status, c.subtype, c.reason], JSON.stringify(c)).toEqual([
      'CRASH',
      'RESOURCE_LIMIT',
      'OUTPUT_LIMIT',
    ])
  })
})

describe('drapeau SLOW (A-10)', () => {
  it('tally sur un tableau de 1000 éléments (stratégie size) : test ≫ baseline ⇒ SLOW, statut inchangé', async () => {
    const m = plan.mutations.find((x) => x.export === 'tally' && x.strategy === 'size')
    const r = await cli(['--json', 'replay', m?.id ?? ''])
    expect(r.code, r.err).toBe(0)
    const c = json<{ classification: { status: string; flags?: string[] } }>(r).classification
    expect([c.status, c.flags]).toEqual(['PASSED', ['SLOW']])
    // Contre-épreuve (au-dessous du seuil, plancher) : tests déterministes de l'oracle
    // (packages/core/test/oracle.test.ts). Ici, une mutation « rapide » dépendrait de la vitesse de la
    // machine (bruit de mesure > 100 ms sur un runner Windows chargé) : volontairement absente.
  })
})

describe('limite de mémoire sous Vitest (A-03)', () => {
  it('grow(null) sous Vitest, tas limité à 128 Mo ⇒ CRASH / RESOURCE_LIMIT (OUT_OF_MEMORY)', async () => {
    const dir = resolve('examples/limits-vitest-project')
    const data = newDataDir()
    const cfg = limitsConfig('test: { framework: vitest }')
    const run = (args: string[]) => varia(['--data-dir', data, '--config', cfg, ...args], dir)
    expect((await run(['baseline'])).code).toBe(0)
    expect((await run(['-q', 'plan', '--out', join(data, 'plan.json')])).code).toBe(0)
    const p = JSON.parse(readFileSync(join(data, 'plan.json'), 'utf8')) as typeof plan
    const m = p.mutations.find((x) => x.export === 'grow' && x.value === null)
    const r = await run(['--json', 'replay', m?.id ?? ''])
    const c = json<{ classification: { status: string; subtype?: string; reason?: string } }>(
      r,
    ).classification
    expect([c.status, c.subtype, c.reason]).toEqual(['CRASH', 'RESOURCE_LIMIT', 'OUT_OF_MEMORY'])
  })
})
