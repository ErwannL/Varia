import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Json } from '../src/events.js'
import type { Plan, PlannedMutation } from '../src/plan.js'
import { stableStringify } from '../src/serialize.js'
import { Spike } from '../src/spike.js'

export const EXAMPLE = resolve('examples/jest-project')

export function newDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'varia-data-'))
}

export function newSpike(dataDir: string): Spike {
  return new Spike({ root: EXAMPLE, dataDir, include: ['src/**'], timeoutMs: 3000 })
}

/** Options de plan du spike J0 (C.0 : au plus 3 mutations sur `repeat`, valeur déclarée pour `exitOn`). */
export const PLAN_OPTIONS = {
  seed: 42,
  perInput: 20,
  skip: ['repeat#arg0'],
  perTarget: { 'src/values.js#repeat': 3 },
  extraValues: { 'exitOn#arg0': ['boom'] as Json[] },
}

export function pick(
  plan: Plan,
  where: {
    export: string
    test?: string
    pathStr: string
    strategy?: string
    value?: Json
    sequence?: number
  },
): PlannedMutation {
  const found = plan.mutations.find(
    (m) =>
      m.export === where.export &&
      m.pathStr === where.pathStr &&
      (where.test === undefined || m.testName === where.test) &&
      (where.strategy === undefined || m.strategy === where.strategy) &&
      (where.sequence === undefined || m.sequence === where.sequence) &&
      (where.value === undefined ||
        (m.op === 'set' && stableStringify(m.value) === stableStringify(where.value))),
  )
  if (!found) throw new Error(`mutation introuvable : ${JSON.stringify(where)}`)
  return found
}
