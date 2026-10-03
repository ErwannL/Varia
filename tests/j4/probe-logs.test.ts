// P-01 : les journaux JSONL RÉELLEMENT produits par la sonde sous Jest et sous Vitest (conservés avec
// keepTmp, dans un dossier de données temporaire) sont valides contre les JSON Schema publiés dans
// packages/probe-protocol/schema/ — validés par un validateur indépendant (Ajv 2020-12), pas par Zod.
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JestAdapter } from '@varia/adapter-jest'
import { VitestAdapter } from '@varia/adapter-vitest'
import type { TestAdapter } from '@varia/core'
import { EngineContext, planRun, runBaseline, runFuzz } from '@varia/engine'

// Pas de tests/j1/helpers.js : il charge le CLI entier ; seul le moteur et les adaptateurs servent ici.
const EXAMPLE = resolve('examples/jest-project')
const newDataDir = () => mkdtempSync(join(tmpdir(), 'varia-j4-'))
/** Exemple Jest sans les cibles qui bouclent, quittent ou dépendent de l'horloge (cf. j1/helpers). */
function deterministicConfig(): string {
  const file = join(newDataDir(), 'varia.yml')
  writeFileSync(
    file,
    [
      'version: 1',
      'project: { name: jest-project }',
      "targets: { mode: auto, include: ['src/**'], exclude: ['src/values.js', 'src/notify.js', 'src/chain.js'] }",
      'mutations: { mode: normal, seed: 42 }',
      'execution: { timeout_ms: 30000 }',
      'oracle: { slow_floor_ms: 3600000 }',
    ].join('\n'),
  )
  return file
}

/**
 * Baseline, plan et mutations par le MOTEUR (même chemin que `varia ci --keep-tmp`), avec un adaptateur
 * réel ; les journaux de la sonde sont conservés dans le dossier de données temporaire.
 */
async function realRun(adapter: TestAdapter, root: string, configFile?: string): Promise<string> {
  const dataDir = newDataDir()
  const ctx = new EngineContext({
    root,
    adapter,
    dataDir,
    mode: 'quick',
    keepTmp: true,
    ...(configFile !== undefined ? { configFile } : {}),
  })
  try {
    const b = await runBaseline(ctx)
    planRun(ctx, b.runId, { seed: 9, maxMutations: 12 })
    await runFuzz(ctx, b.runId)
  } finally {
    ctx.close()
  }
  return dataDir
}

// Ajv 8 (dialecte 2020-12), déjà présent via Fastify (aucune dépendance ajoutée).
const fastifyRequire = createRequire(createRequire(import.meta.url).resolve('fastify'))
const ajvRequire = createRequire(fastifyRequire.resolve('@fastify/ajv-compiler'))
const Ajv2020 = (ajvRequire('ajv/dist/2020') as { default: new (o: object) => AjvLike }).default
interface AjvLike {
  compile(s: object): ((v: unknown) => boolean) & { errors?: unknown }
}
const ajv = new Ajv2020({ strict: true, allErrors: true })

const SCHEMAS = resolve('packages/probe-protocol/schema')
const schemaOf = (type: string) =>
  JSON.parse(
    readFileSync(join(SCHEMAS, `${type.toLowerCase().replace(/_/g, '-')}.schema.json`), 'utf8'),
  ) as object
const union = ajv.compile(schemaOf('PROBE_MESSAGE'))
const perType = new Map<string, ReturnType<AjvLike['compile']>>()

const files = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })

/** Valide chaque ligne de chaque JSONL conservé ; renvoie les types vus et les écarts. */
function validateLogs(dataDir: string) {
  const jsonl = files(dataDir).filter((f) => /probe-\d+\.jsonl$/.test(f))
  const seen = new Map<string, number>()
  const errors: string[] = []
  for (const f of jsonl)
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (line === '') continue
      const msg = JSON.parse(line) as { type: string }
      seen.set(msg.type, (seen.get(msg.type) ?? 0) + 1)
      let v = perType.get(msg.type)
      if (v === undefined) {
        v = ajv.compile(schemaOf(msg.type))
        perType.set(msg.type, v)
      }
      if (!v(msg)) errors.push(`${msg.type} ${JSON.stringify(v.errors)} ${line.slice(0, 300)}`)
      if (!union(msg)) errors.push(`union ${msg.type}`)
    }
  return { jsonl, seen, errors }
}

describe('JSONL réels ↔ JSON Schema publiés (P-01)', () => {
  it('le validateur refuse une ligne hors schéma (contre-épreuve)', () => {
    const hello = ajv.compile(schemaOf('HELLO'))
    const ok = {
      protocolVersion: 1,
      runId: 'r',
      type: 'HELLO',
      testId: null,
      timestamp: 'T',
      mode: 'observe',
      pid: 1,
      mutationId: null,
    }
    expect(hello(ok)).toBe(true)
    expect(hello({ ...ok, futureField: 1 })).toBe(true)
    expect(hello({ ...ok, mode: 'autre' })).toBe(false)
    expect(union({ ...ok, protocolVersion: 2 })).toBe(false)
  })

  it('adaptateur Jest : chaque ligne de chaque journal est valide', async () => {
    const D = await realRun(new JestAdapter(), EXAMPLE, deterministicConfig())
    const { jsonl, seen, errors } = validateLogs(D)
    expect(jsonl.length).toBeGreaterThan(0)
    expect(errors).toEqual([])
    for (const t of [
      'HELLO',
      'DISCOVER',
      'TEST_START',
      'TEST_END',
      'OBSERVE_CALL',
      'MUTATE_CALL',
      'TARGET_RETURN',
      'TARGET_THROW',
    ])
      expect(seen.get(t) ?? 0, t).toBeGreaterThan(0)
  })

  it('adaptateur Vitest : chaque ligne de chaque journal est valide', async () => {
    const D = await realRun(new VitestAdapter(), resolve('examples/vitest-project'))
    const { jsonl, seen, errors } = validateLogs(D)
    expect(jsonl.length).toBeGreaterThan(0)
    expect(errors).toEqual([])
    for (const t of [
      'HELLO',
      'DISCOVER',
      'TEST_START',
      'TEST_END',
      'OBSERVE_CALL',
      'MUTATE_CALL',
      'TARGET_RETURN',
      'TARGET_THROW',
    ])
      expect(seen.get(t) ?? 0, t).toBeGreaterThan(0)
  })

  it('PROBE_ERROR et UNHANDLED_REJECTION écrits par la vraie sonde (en processus) : valides', () => {
    const P = (
      createRequire(import.meta.url)(
        '../../packages/probe-runtime/runtime/probe.cjs',
      ) as typeof import('../../packages/probe-runtime/runtime/probe.cjs')
    ).internals
    const runDir = newDataDir()
    const st = P.init({ VARIA_MODE: 'observe', VARIA_RUN_DIR: runDir })
    if (st === null) throw new Error('sonde inactive')
    P.probeError(st, 'prepare', new TypeError('x'), { module: 'src/a.js', export: 'f' })
    P.onUnhandledRejection(st, Object.assign(new Error('r'), { status: 'abc' }), null)
    const { seen, errors } = validateLogs(runDir)
    expect(errors).toEqual([])
    expect([...seen]).toEqual([
      ['PROBE_ERROR', 1],
      ['UNHANDLED_REJECTION', 1],
    ])
  })
})
