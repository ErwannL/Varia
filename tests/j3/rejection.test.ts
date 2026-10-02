// A-02 : un rejet de promesse que personne n'attend est détecté dans le processus de test, attribué à
// l'appel muté et classé CRASH / UNHANDLED_REJECTION ; un rejet ATTENDU (TARGET_REJECT) reste distinct.
import type { PlannedMutation } from '@varia/core'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { json, newDataDir, varia } from '../j1/helpers.js'

interface Replay {
  classification: { status: string; subtype?: string; outcome?: string; error?: { name: string } }
}

const D = newDataDir()
let plan: { mutations: PlannedMutation[] }

beforeAll(async () => {
  const b = await varia(['--data-dir', D, 'baseline'])
  expect(b.code, b.err).toBe(0)
  const p = await varia(['--data-dir', D, '-q', 'plan', '--out', join(D, 'plan.json')])
  expect(p.code, p.err).toBe(0)
  plan = JSON.parse(readFileSync(join(D, 'plan.json'), 'utf8')) as typeof plan
})

const replay = async (export_: string, path: string, value: unknown) => {
  const m = plan.mutations.find(
    (x) =>
      x.export === export_ &&
      x.pathStr === path &&
      x.op === 'set' &&
      JSON.stringify(x.value) === JSON.stringify(value),
  )
  if (m === undefined) throw new Error(`mutation absente du plan : ${export_} ${path}`)
  const r = await varia(['--data-dir', D, '--json', 'replay', m.id])
  expect(r.code, r.err).toBe(0)
  return json<Replay>(r).classification
}

describe('rejets de promesse non gérés (A-02)', () => {
  it('scheduleWelcome({ email: null }) : retour normal puis rejet non géré ⇒ CRASH / UNHANDLED_REJECTION', async () => {
    const c = await replay('scheduleWelcome', 'arg0.email', null)
    expect([c.status, c.subtype, c.error?.name]).toEqual([
      'CRASH',
      'UNHANDLED_REJECTION',
      'TypeError',
    ])
  })
  it('fetchUser("7") : rejet ATTENDU par le test ⇒ HANDLED, pas un rejet non géré', async () => {
    const c = await replay('fetchUser', 'arg0', '7')
    expect([c.status, c.outcome, c.subtype]).toEqual(['HANDLED', 'reject', undefined])
  })
})
