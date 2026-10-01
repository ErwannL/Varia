// J0-19 / J0-20 : explorations sans seuil (CDC C.1). Ces tests figent le comportement OBSERVÉ,
// qui définit le périmètre de J1 ; un changement de comportement les fera échouer.
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Spike } from '../src/spike.js'
import { newDataDir, pick } from './helpers.js'

const spikes: Spike[] = []
const make = (dir: string, extra: { nodeOptions?: string } = {}) => {
  const s = new Spike({
    root: resolve('examples', dir),
    dataDir: newDataDir(),
    timeoutMs: 30_000,
    ...extra,
  })
  spikes.push(s)
  return s
}
afterAll(() => spikes.forEach((s) => s.dispose()))

describe('J0-19 TypeScript (ts-jest)', () => {
  it('observation, mutation et classification identiques au JavaScript ; piles en lignes .ts', async () => {
    const s = make('ts-project')
    const { observation } = await s.baseline()
    expect(observation.calls.map((c) => c.export).sort()).toEqual([
      'createUser',
      'echoValue',
      'fetchUser',
    ])
    const plan = s.plan(observation, { seed: 1, perInput: 20 })
    s.savePlan(plan)
    const handled = await s.execute(
      plan,
      pick(plan, { export: 'createUser', pathStr: 'arg0.name', value: null }),
    )
    const crash = await s.execute(
      plan,
      pick(plan, { export: 'createUser', pathStr: 'arg0.name', value: {} }),
    )
    const echo = await s.execute(
      plan,
      pick(plan, { export: 'echoValue', pathStr: 'arg0', strategy: 'type', value: {} }),
    )
    expect(handled.classification.status).toBe('HANDLED')
    expect(crash.classification.status).toBe('CRASH')
    expect(crash.classification.error?.stack).toMatch(/src\/users\.ts:\d+:\d+/)
    expect(echo.classification.reason).toBe('ECHO')
  })
})

describe('J0-20 ESM natif', () => {
  it('la sonde démarre mais aucun module n’est enveloppé : non supporté (J2)', async () => {
    const s = make('esm-project', { nodeOptions: '--experimental-vm-modules' })
    const { run, observation } = await s.baseline()
    expect(run.report?.numPassedTests).toBe(1)
    expect(run.log.events.some((e) => e.type === 'HELLO')).toBe(true)
    expect(observation.discovered).toEqual({})
    expect(observation.calls).toEqual([])
  })
})

describe('J0-20 jest.resetModules / isolateModules / jest.mock', () => {
  it('séquences conservées après resetModules ; cibles mockées non observées', async () => {
    const s = make('mocks-project')
    const { observation } = await s.baseline()
    const sites = (name: string) =>
      observation.calls
        .filter((c) => c.testId === observation.tests.find((t) => t.name === name)?.testId)
        .map((c) => `${c.export}@${c.depth}#${c.sequence}`)
    expect(sites('après resetModules')).toEqual(['greet@0#0', 'greet@0#1'])
    expect(sites('isolateModules')).toEqual(['greet@0#0'])
    expect(sites('welcome avec users mocké par fabrique')).toEqual(['welcome@0#0'])
    expect(sites('welcome avec users automocké')).toEqual(['welcome@0#0'])
  })
})
