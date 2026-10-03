// Le lanceur factice de examples/custom-project implémente LUI-MÊME la sonde : il rejoue tout le jeu
// de conformité du protocole (packages/probe-protocol/conformance/) avec ses propres fonctions. Seuls
// le constructeur d'entrées neutres et le comparateur viennent de l'outillage de rejeu de référence.
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  build,
  mismatches,
  type Case,
  type CaseFile,
} from '../../../probe-runtime/test/conformance-lib.js'

interface Runner {
  canonical(v: unknown, indent?: number): string
  callOptions(red: unknown, exp: string, secrets: string[]): unknown
  callSiteIdOf(t: string, m: string, e: string, d: number, s: number): string
  compileRedaction(r: object): unknown
  fingerprint(v: unknown): string
  serialize(v: unknown, o: unknown, root: string): unknown
  serializeArgs(a: unknown[], o: unknown): unknown[]
  serializeError(e: unknown, secrets: string[]): unknown
  sha256(s: string): string
  testIdOf(f: string, n: string, r: number): string
}
const R = createRequire(import.meta.url)(resolve('examples/custom-project/runner.cjs')) as Runner

const casesDir = resolve('packages/probe-protocol/conformance/cases')
const docs = readdirSync(casesDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => [f, JSON.parse(readFileSync(resolve(casesDir, f), 'utf8')) as CaseFile] as const)

type J = Case['expected']
const arr = (v: J | undefined) => (Array.isArray(v) ? v : [])
const opts = (input: Record<string, J>, secrets: string[]) => {
  const redact = input['redact']
  const red = R.compileRedaction(
    redact !== null && typeof redact === 'object' && !Array.isArray(redact) ? redact : {},
  )
  return R.callOptions(red, typeof input['export'] === 'string' ? input['export'] : 'f', secrets)
}

/** Opération du jeu exécutée par le lanceur factice. */
function run(c: Case): unknown {
  const i = c.input
  switch (c.op) {
    case 'serialize':
      return R.serialize(build(i['value'] ?? null), opts({}, []), '')
    case 'serializeArgs': {
      const args = R.serializeArgs(
        arr(i['args']).map((a) => build(a)),
        opts(i, []),
      )
      return { args, argsFingerprint: R.fingerprint(args) }
    }
    case 'serializeError': {
      const secrets: string[] = []
      R.serializeArgs(
        arr(i['args']).map((a) => build(a)),
        opts(i, secrets),
      )
      return R.serializeError(build(i['error'] ?? null), secrets)
    }
    case 'testId':
      return R.testIdOf(String(i['file']), String(i['name']), Number(i['rank']))
    case 'callSiteId':
      return R.callSiteIdOf(
        String(i['testId']),
        String(i['module']),
        String(i['export']),
        Number(i['depth']),
        Number(i['sequence']),
      )
    default: {
      const text = R.canonical(i['value'], Number(i['indent'] ?? 0))
      return { text, sha256: R.sha256(text) }
    }
  }
}

describe('rejeu du jeu de conformité du protocole par le lanceur factice', () => {
  it('toutes les opérations sont présentes', () => {
    expect(new Set(docs.flatMap(([, d]) => d.cases.map((c) => c.op)))).toEqual(
      new Set([
        'serialize',
        'serializeArgs',
        'serializeError',
        'testId',
        'callSiteId',
        'canonical',
      ]),
    )
  })
  for (const [file, doc] of docs)
    describe(file, () => {
      it.each(doc.cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
        expect(mismatches(run(c), c.expected)).toEqual([])
      })
    })
})
