// J4 X-02 / T-01 : les extensions d'exemple (examples/plugins/) testées de bout en bout avec la SEULE
// API publique de @varia/testkit — comme le ferait l'auteur d'une extension.
import {
  assertDeterministic,
  assertStatus,
  callSite,
  checkDeterminism,
  evaluateRules,
  generateWith,
  inputAt,
  inputsOf,
  mutationOf,
  planFor,
  renderWith,
  runMutation,
} from '@varia/testkit'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PLUGINS = resolve('examples/plugins')
const IBAN = './iban/index.mjs'
const RULE = './oracle-codes/index.mjs'
const CSV = './csv-reporter/index.mjs'
const VALID = 'FR7630006000011234567890189'
const { transfer } = createRequire(import.meta.url)(
  resolve('examples/plugins-project/src/payments.js'),
) as { transfer: (o: { iban: unknown; amount: unknown; token?: unknown }) => unknown }

/** Contrôle ISO 13616 (indépendant de l'extension) : pays connu (extrait), reste 1 modulo 97. */
const isValidIban = (s: string) => {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false
  if (!['FR', 'DE', 'BE', 'ES', 'IT', 'NL'].includes(s.slice(0, 2))) return false
  let rest = 0
  for (const c of s.slice(4) + s.slice(0, 4))
    for (const d of String(parseInt(c, 36))) rest = (rest * 10 + Number(d)) % 97
  return rest === 1
}

const call = callSite({
  module: 'src/payments.js',
  export: 'transfer',
  args: [{ iban: VALID, amount: 10, token: 'sk_live_TRES_SECRET' }],
})
const ibanInput = inputAt(call, 'arg0.iban')
const opts = { plugin: IBAN, baseDir: PLUGINS, strategy: 'iban/invalid-iban', seed: 42 }

describe('stratégie « IBAN invalide » (examples/plugins/iban)', () => {
  it('ne propose que des IBAN invalides, pour le seul champ IBAN', () => {
    expect(isValidIban(VALID)).toBe(true)
    const r = generateWith({ ...opts, inputs: inputsOf(call) })
    expect(r.failures).toEqual([])
    expect([...r.candidates.keys()]).toEqual([`${call.callSiteId}|arg0.iban`])
    const values = (r.candidates.get(`${call.callSiteId}|arg0.iban`) ?? []).map((c) => c.value)
    expect(values).toHaveLength(8)
    for (const v of values) expect(isValidIban(String(v)), String(v)).toBe(false)
    expect(values).toContain('ZZ' + String(values[1]).slice(2, 4) + VALID.slice(4))
  })

  it('secret masqué : l’extension ne le reçoit jamais (entrée non mutable)', () => {
    const token = inputsOf(call).find((i) => i.pathStr === 'arg0.token')
    expect(token?.mutable).toBe(false)
    expect(JSON.stringify(token?.original)).not.toContain('sk_live')
  })

  it('purement déterministe : deux sessions, même graine ⇒ mêmes candidats ; graine sans effet', () => {
    const a = assertDeterministic({ ...opts, inputs: [ibanInput] })
    const b = checkDeterminism({ ...opts, seed: 7, inputs: [ibanInput] })
    expect(b.deterministic).toBe(true)
    expect([...b.candidates]).toEqual([...a])
  })

  it('révèle le défaut du projet : pays inconnu ⇒ CRASH (TypeError) ; clé fausse ⇒ refus', async () => {
    const values = generateWith({ ...opts, inputs: [ibanInput] }).candidates.get(
      `${call.callSiteId}|arg0.iban`,
    )
    const [wrongKey, unknownCountry] = values ?? []
    const run = (value: unknown) =>
      runMutation({
        target: transfer as never,
        call,
        mutation: mutationOf(ibanInput, { strategy: 'iban/invalid-iban', value: value as never }),
      })
    const crash = await run(unknownCountry?.value)
    assertStatus(crash.classification, 'CRASH')
    expect(crash.classification.error?.name).toBe('TypeError')
    const refused = await run(wrongKey?.value)
    // Sans règle : une `Error` générique n'est pas un refus connu de l'oracle intégré.
    assertStatus(refused.classification, 'UNEXPECTED_FAILURE')
    expect(refused.classification.error?.code).toBe('E_VALIDATION_IBAN')
  })
})

describe('règle d’oracle (examples/plugins/oracle-codes)', () => {
  const m = mutationOf(ibanInput, { strategy: 'iban/invalid-iban', value: 'FR00' })
  it('code E_VALIDATION* ⇒ HANDLED, raison traçable ; un CRASH reste un CRASH', async () => {
    const r = await runMutation({
      target: transfer as never,
      call,
      mutation: m,
      plugins: [RULE],
      baseDir: PLUGINS,
    })
    expect(r.pluginFailures).toEqual([])
    assertStatus(r.classification, 'HANDLED', {
      reason: 'RULE:codes/validation-code:VALIDATION_CODE',
    })
    const crash = await runMutation({
      target: transfer as never,
      call,
      mutation: mutationOf(ibanInput, { strategy: 'iban/invalid-iban', value: 'ZZ00X' }),
      plugins: [RULE],
      baseDir: PLUGINS,
    })
    assertStatus(crash.classification, 'CRASH', { reason: null })
  })

  it('sans code de validation : aucun avis', () => {
    const r = evaluateRules({
      plugin: RULE,
      baseDir: PLUGINS,
      input: {
        mutation: {
          id: m.id,
          target: 'src/payments.js#transfer',
          path: 'arg0.iban',
          strategy: m.strategy,
          op: 'set',
          original: VALID,
          value: 'FR00',
        },
        classification: { status: 'UNEXPECTED_FAILURE', subtype: null, reason: null },
        outcome: { kind: 'throw', value: null, error: null },
        testStatus: 'failed',
      },
    })
    expect(r).toEqual({ verdict: null, failures: [] })
  })
})

describe('rapporteur CSV (examples/plugins/csv-reporter)', () => {
  it('une ligne par mutation du plan, champs échappés', () => {
    const extra = generateWith({ ...opts, inputs: [ibanInput] }).candidates
    const plan = planFor([call], { extra })
    expect(plan.mutations).toHaveLength(8)
    const report = {
      mutations: plan.mutations.map((x) => ({
        id: x.id,
        target: `${x.module}#${x.export}`,
        path: x.pathStr,
        strategy: x.strategy,
        status: 'HANDLED',
        reason: 'a "b"',
        value: x.value,
      })),
    }
    const r = renderWith({ plugin: CSV, baseDir: PLUGINS, report })
    expect(r.failures).toEqual([])
    expect(r.outputs.map((o) => [o.id, o.extension])).toEqual([['csv/mutations', 'csv']])
    const lines = (r.outputs[0]?.content ?? '').trimEnd().split('\n')
    expect(lines[0]).toBe('id,target,path,strategy,status,reason,value')
    expect(lines).toHaveLength(9)
    expect(lines[1]).toContain('"a ""b"""')
  })
})
