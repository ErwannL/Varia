// R-03 : scénarios d'acceptation du §5 (J4) sur examples/phpunit-project, par le MOTEUR avec l'adapter
// PHPUnit réel (le CLI n'est pas encore branché). (1) baseline et observation, (2) stabilité, (3) HANDLED
// / CRASH / ECHO, (4) statut du test sans influence, (5) plan identique octet pour octet, (9) une seule
// occurrence mutée, (10) empreinte divergente, (12) projet inchangé ; JSONL valides contre les schémas.
// (8) NOT FEASIBLE : PHP est synchrone (aucune promesse, aucun rejet asynchrone dans le langage).
// Les scénarios (6) (7) (11) (13) (14) sont dans phpunit-process.test.ts.
import { PhpunitAdapter } from '@varia/adapter-phpunit'
import type { PlannedMutation } from '@varia/core'
import { diffSnapshots, gitSnapshot, manifestSnapshot, mutationId } from '@varia/core'
import {
  EngineContext,
  planRun,
  replayMutation,
  runBaseline,
  runFuzz,
  savePlan,
} from '@varia/engine'
import { createRequire } from 'node:module'
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

export const PHPUNIT = resolve('examples/phpunit-project')
const before = { git: gitSnapshot(PHPUNIT), manifest: manifestSnapshot(PHPUNIT) }
const VALID = 'createUser crée un utilisateur valide'
const D = mkdtempSync(join(tmpdir(), 'varia-j4-phpunit-'))
const ctx = new EngineContext({
  root: PHPUNIT,
  adapter: new PhpunitAdapter(),
  dataDir: D,
  keepTmp: true,
})
let runId = ''
let plan: { mutations: PlannedMutation[] }
let planText = ''

const pick = (w: {
  export: string
  pathStr: string
  test?: string
  strategy?: string
  sequence?: number
  value?: unknown
}) => {
  const m = plan.mutations.find(
    (x) =>
      x.export === w.export &&
      x.pathStr === w.pathStr &&
      (w.test === undefined || x.testName === w.test) &&
      (w.strategy === undefined || x.strategy === w.strategy) &&
      (w.sequence === undefined || x.sequence === w.sequence) &&
      (!('value' in w) || (x.op === 'set' && JSON.stringify(x.value) === JSON.stringify(w.value))),
  )
  if (!m) throw new Error(`mutation introuvable : ${JSON.stringify(w)}`)
  return m
}

beforeAll(async () => {
  const b = await runBaseline(ctx)
  runId = b.runId
  const p = planRun(ctx, runId, {})
  planText = readFileSync(p.planPath, 'utf8')
  plan = JSON.parse(planText) as typeof plan
}, 120_000)

describe('PHPUnit (1) (2) : baseline, observation, stabilité', () => {
  it('(1) 11 tests verts, appels createUser observés avec leurs arguments (mot de passe masqué)', () => {
    const tests = ctx.reader.tests(runId)
    expect(tests).toHaveLength(11)
    expect(tests.every((t) => t.status === 'passed')).toBe(true)
    const args = ctx.reader
      .callSites(runId)
      .filter((c) => c.export === 'createUser')
      .map((c) => (c.args as Record<string, unknown>[])[0])
    expect(args.map((a) => a?.['name']).sort()).toEqual([
      'Ada',
      'Alice',
      'Bob',
      'Chloé',
      'Erwann',
      'Grace',
      'Linus',
    ])
    expect(args.every((a) => (a?.['password'] as { $redacted?: boolean }).$redacted === true)).toBe(
      true,
    )
    // Test paramétré (dataProvider) : trois tests distincts, noms TestDox substitués.
    expect(
      tests
        .filter((t) => t.name.startsWith('createUser accepte'))
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      'createUser accepte Alice (30 ans)',
      'createUser accepte Bob (40 ans)',
      'createUser accepte Chloé (50 ans)',
    ])
  })
  it('(2) exécutions répétées identiques : seul le test aux arguments non déterministes est FLAKY', () => {
    expect(
      ctx.reader
        .tests(runId)
        .filter((t) => t.flaky)
        .map((t) => [t.name, t.flakyReasons]),
    ).toEqual([['echoValue renvoie un horodatage', ['NON_DETERMINISTIC_INPUT']]])
  })
  it('profondeurs 0 et 1 (transitif non muté) ; méthode privée jamais observée', () => {
    const cs = ctx.reader.callSites(runId)
    expect(cs.filter((c) => c.export === 'inner').map((c) => c.depth)).toEqual([1, 1])
    expect(cs.filter((c) => c.export === 'outer').map((c) => c.depth)).toEqual([0, 0])
    expect(cs.filter((c) => c.export === 'helper').map((c) => c.depth)).toEqual([1])
    expect(cs.some((c) => c.export === 'double')).toBe(false)
    expect(ctx.reader.targets(runId).find((t) => t.export === 'inner')?.status).toBe(
      'TRANSITIVE_ONLY',
    )
    expect(plan.mutations.some((m) => m.export === 'inner' || m.export === 'helper')).toBe(false)
  })
})

describe('PHPUnit (5) : plan', () => {
  it('même graine ⇒ plan identique octet pour octet, y compris après une nouvelle baseline', async () => {
    expect(readFileSync(planRun(ctx, runId, {}).planPath, 'utf8')).toBe(planText)
    const b2 = await runBaseline(ctx)
    expect(readFileSync(planRun(ctx, b2.runId, {}).planPath, 'utf8')).toBe(
      planText.replaceAll(runId, b2.runId),
    )
    expect(plan.mutations.filter((m) => m.export === 'repeat')).toHaveLength(3)
  }, 120_000)
})

describe('PHPUnit (3) (4) (9) : classification par rejeu', () => {
  it('(3) (4) null ⇒ HANDLED, {} ⇒ CRASH (TypeError), "" ⇒ HANDLED ; test en échec dans les trois cas', async () => {
    const out = []
    for (const value of [null, {}, ''])
      out.push(
        (
          await replayMutation(
            ctx,
            pick({ export: 'createUser', test: VALID, pathStr: 'arg0.name', value }).id,
          )
        ).classification,
      )
    expect(out.map((c) => c.status)).toEqual(['HANDLED', 'CRASH', 'HANDLED'])
    expect(out.map((c) => c.testStatus)).toEqual(['failed', 'failed', 'failed'])
    expect(out[1]?.error?.constructorChain).toEqual(['TypeError', 'Error'])
    expect(out[0]?.error?.constructorChain).toEqual([
      'ValidationError',
      'DomainException',
      'LogicException',
      'Exception',
    ])
  }, 120_000)
  it('(3) écho d’une valeur d’un autre type ⇒ SUSPICIOUS_ACCEPT / ECHO ; null renvoyé ⇒ pas d’ECHO', async () => {
    const T = 'echoValue renvoie sa valeur'
    const echo = await replayMutation(
      ctx,
      pick({ export: 'echoValue', test: T, pathStr: 'arg0', strategy: 'type', value: {} }).id,
    )
    const nul = await replayMutation(
      ctx,
      pick({ export: 'echoValue', test: T, pathStr: 'arg0', value: null }).id,
    )
    const c = echo.classification
    expect([c.subtype, c.reason, c.echoPath]).toEqual([
      'SUSPICIOUS_ACCEPT',
      'ECHO',
      'return.received',
    ])
    expect([nul.classification.status, nul.classification.subtype]).toEqual(['PASSED', undefined])
  }, 120_000)
  it('(9) seule la 2ᵉ des trois occurrences est mutée, les autres gardent leur empreinte', async () => {
    const m = pick({
      export: 'createUser',
      test: 'createUser crée trois utilisateurs',
      pathStr: 'arg0.age',
      sequence: 1,
      value: '45',
    })
    const calls = (await replayMutation(ctx, m.id)).calls.filter((c) => c.export === 'createUser')
    expect(calls.map((c) => c.mutated)).toEqual([false, true, false])
    const base = ctx.reader
      .callSites(runId)
      .filter((c) => c.testId === m.testId)
      .sort((a, b) => a.sequence - b.sequence)
    expect(calls.map((c) => c.argsFingerprint)).toEqual(base.map((c) => c.argsFingerprint))
  }, 120_000)
})

describe('PHPUnit (10) : empreinte divergente', () => {
  it('mutation forcée sur le call site non déterministe ⇒ SKIPPED / AMBIGUOUS_CALL_SITE', async () => {
    const test = ctx.reader.tests(runId).find((t) => t.name === 'echoValue renvoie un horodatage')
    const site = ctx.reader
      .callSites(runId)
      .find((c) => c.testId === test?.testId && c.export === 'echoValue')
    if (!test || !site) throw new Error('call site introuvable')
    const forced: PlannedMutation = {
      id: mutationId(site.callSiteId, 'arg0', 'null', 'set', null),
      callSiteId: site.callSiteId,
      testId: test.testId,
      testFile: test.file,
      testName: test.name,
      module: site.module,
      export: site.export,
      depth: 0,
      sequence: site.sequence,
      argsFingerprint: site.argsFingerprint,
      path: ['0'],
      pathStr: 'arg0',
      strategy: 'null',
      op: 'set',
      original: (site.args as string[])[0] ?? '',
      value: null,
      originalType: 'string',
      mutatedType: 'null',
    }
    const b = await runBaseline(ctx)
    savePlan(ctx, b.runId, {
      schemaVersion: 1,
      variaVersion: '0.1.0',
      seed: 1,
      gitCommit: null,
      configHash: '',
      possible: 1,
      mutations: [forced],
    } as Parameters<typeof savePlan>[2])
    await runFuzz(ctx, b.runId)
    expect(ctx.reader.results(b.runId).map((r) => [r.mutationId, r.status, r.reason])).toEqual([
      [forced.id, 'SKIPPED', 'AMBIGUOUS_CALL_SITE'],
    ])
  }, 120_000)
})

// Ajv 8 (dialecte 2020-12), déjà présent via Fastify (aucune dépendance ajoutée), comme probe-logs.test.ts.
const fastifyRequire = createRequire(createRequire(import.meta.url).resolve('fastify'))
const ajvRequire = createRequire(fastifyRequire.resolve('@fastify/ajv-compiler'))
const Ajv2020 = (
  ajvRequire('ajv/dist/2020') as {
    default: new (o: object) => {
      compile(s: object): ((v: unknown) => boolean) & { errors?: unknown }
    }
  }
).default
const files = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })

describe('JSONL de la sonde PHP ↔ JSON Schema publiés (P-01)', () => {
  it('chaque ligne de chaque journal conservé est valide (schéma de son type et union)', () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true })
    const schema = (t: string) =>
      JSON.parse(
        readFileSync(
          resolve(
            'packages/probe-protocol/schema',
            `${t.toLowerCase().replace(/_/g, '-')}.schema.json`,
          ),
          'utf8',
        ),
      ) as object
    const union = ajv.compile(schema('PROBE_MESSAGE'))
    const seen = new Set<string>()
    const errors: string[] = []
    for (const f of files(D).filter((x) => /probe-\d+\.jsonl$/.test(x)))
      for (const line of readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => l !== '')) {
        const msg = JSON.parse(line) as { type: string }
        seen.add(msg.type)
        const v = ajv.compile(schema(msg.type))
        if (!v(msg) || !union(msg)) errors.push(`${JSON.stringify(v.errors)} ${line.slice(0, 200)}`)
      }
    expect(errors).toEqual([])
    expect([...seen].sort()).toEqual([
      'DISCOVER',
      'HELLO',
      'MUTATE_CALL',
      'OBSERVE_CALL',
      'TARGET_RETURN',
      'TARGET_THROW',
      'TEST_END',
      'TEST_START',
    ])
  })
})

afterAll(() => {
  ctx.close()
  // (12) Projet inchangé (git et manifeste) après toutes les exécutions de ce fichier.
  expect(diffSnapshots(before.git, gitSnapshot(PHPUNIT))).toEqual([])
  expect(diffSnapshots(before.manifest, manifestSnapshot(PHPUNIT))).toEqual([])
})
