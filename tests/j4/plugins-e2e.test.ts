// J4 X-02 / X-03 : extensions chargées depuis `plugins: [...]` dans un VRAI run (CLI en mémoire, Jest,
// projet examples/plugins-project) : stratégie, règle d'oracle et rapporteur d'exemple ; puis des
// extensions fautives (absente, version incompatible, exception, non-déterminisme, forme invalide,
// boucle, règle et rapporteur qui lèvent) qui ne font jamais tomber le run.
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { newDataDir, varia } from '../j1/helpers.js'

const PROJECT = resolve('examples/plugins-project')
const EXAMPLES = resolve('examples/plugins')
const FAULTY = resolve('tests/j4/fixtures/plugins')

interface Report {
  schemaVersion: number
  mutations: {
    id: string
    path: string
    strategy: string
    value: unknown
    status: string
    reason: string | null
  }[]
  plugins: {
    loaded: {
      name: string
      version: string | null
      extensions: { id: string; disabled: boolean }[]
    }[]
    failures: {
      origin: string
      plugin: string
      extension: string | null
      phase: string
      code: string
    }[]
  }
}

/** Configuration hors du projet (`--config`) : seules `null` et les extensions mutent. */
function config(plugins: string[], timeoutMs: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'varia-cfg-'))
  const file = join(dir, 'varia.yml')
  writeFileSync(
    file,
    [
      'version: 1',
      'project: { name: plugins-project }',
      'test: { framework: jest }',
      "targets: { mode: auto, include: ['src/**'] }",
      'mutations: { mode: normal, seed: 7, strategies: ["null"], per_input: 20 }',
      `execution: { timeout_ms: ${String(timeoutMs)} }`,
      `plugins: [${plugins.map((p) => JSON.stringify(p)).join(', ')}]`,
    ].join('\n'),
  )
  return file
}

async function runWith(plugins: string[], timeoutMs: number) {
  const data = newDataDir()
  const cfg = config(plugins, timeoutMs)
  const cli = (args: string[]) => varia(['--data-dir', data, '--config', cfg, ...args], PROJECT)
  const run = await cli(['test'])
  const out = join(data, 'report.json')
  const dir = join(data, 'extensions')
  const rep = await cli(['report', '--out', out, '--extensions-dir', dir])
  expect(rep.code, rep.err).toBe(0)
  const second = join(data, 'report-2.json')
  expect((await cli(['report', '--out', second])).code).toBe(0)
  const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as Report
  return { run, report: read(out), after: read(second), dir, cli, data }
}

const iban = (r: Report) => r.mutations.filter((m) => m.strategy === 'iban/invalid-iban')

describe('extensions d’exemple dans un vrai run (X-02)', () => {
  let r: Awaited<ReturnType<typeof runWith>>
  beforeAll(async () => {
    r = await runWith(
      [
        join(EXAMPLES, 'iban', 'index.mjs'),
        join(EXAMPLES, 'oracle-codes', 'index.mjs'),
        join(EXAMPLES, 'csv-reporter', 'index.mjs'),
      ],
      30_000,
    )
  })

  it('le run se termine (CRASH trouvé ⇒ code 1) ; extensions chargées signalées, aucune erreur', () => {
    expect(r.run.code, r.run.err).toBe(1)
    expect(r.report.schemaVersion).toBe(4)
    expect(r.report.plugins.loaded.map((p) => p.name)).toEqual(['iban', 'codes', 'csv'])
    // Q-02 : version déclarée par l'extension, recopiée de bout en bout jusqu'au rapport.
    expect(r.report.plugins.loaded.map((p) => p.version)).toEqual(['1.0.0', '1.0.0', '1.0.0'])
    expect(r.report.plugins.failures).toEqual([])
  })

  it('stratégie IBAN : 8 mutations du champ iban ; pays inconnu ⇒ CRASH', () => {
    const m = iban(r.report)
    expect(m).toHaveLength(8)
    expect(new Set(m.map((x) => x.path))).toEqual(new Set(['arg0.iban']))
    const zz = m.find((x) => String(x.value).startsWith('ZZ'))
    expect(zz?.status).toBe('CRASH')
  })

  it('règle d’oracle : un refus E_VALIDATION_IBAN est HANDLED, raison traçable', () => {
    const handled = iban(r.report).filter((x) => x.status === 'HANDLED')
    expect(handled.length).toBeGreaterThanOrEqual(5)
    for (const x of handled) expect(x.reason).toBe('RULE:codes/validation-code:VALIDATION_CODE')
  })

  it('rapporteur CSV : une ligne par mutation, rapport déjà masqué (aucun secret)', () => {
    expect(readdirSync(r.dir)).toEqual(['csv.mutations.csv'])
    const csv = readFileSync(join(r.dir, 'csv.mutations.csv'), 'utf8')
    expect(csv.trimEnd().split('\n')).toHaveLength(r.report.mutations.length + 1)
    expect(csv).not.toContain('sk_live')
    expect(JSON.stringify(r.report)).not.toContain('sk_live')
  })

  it('plan déterministe : même graine ⇒ même plan, mutations externes comprises', async () => {
    const p1 = join(r.data, 'p1.json')
    const p2 = join(r.data, 'p2.json')
    expect((await r.cli(['-q', 'plan', '--out', p1])).code).toBe(0)
    expect((await r.cli(['-q', 'plan', '--out', p2])).code).toBe(0)
    expect(readFileSync(p1, 'utf8')).toBe(readFileSync(p2, 'utf8'))
    expect(readFileSync(p1, 'utf8')).toContain('iban/invalid-iban')
  })

  it('--strategy accepte un identifiant externe ; inconnu ⇒ refus (code 3)', async () => {
    const only = await r.cli(['--json', 'plan', '--strategy', 'iban/invalid-iban'])
    expect(only.code, only.err).toBe(0)
    expect((JSON.parse(only.out) as { planned: number }).planned).toBe(8)
    expect((await r.cli(['plan', '--strategy', 'iban/inconnue'])).code).toBe(3)
    // Filtre qui exclut l'extension : aucune mutation externe, run partiel.
    const builtIn = await r.cli(['--json', 'plan', '--strategy', 'null'])
    expect(builtIn.code, builtIn.err).toBe(0)
    const planPath = (JSON.parse(builtIn.out) as { planPath: string }).planPath
    expect(readFileSync(planPath, 'utf8')).not.toContain('iban/invalid-iban')
  })
})

describe('extensions fautives : jamais fatales, PLUGIN_FAILURE au rapport (X-03)', () => {
  let r: Awaited<ReturnType<typeof runWith>>
  beforeAll(async () => {
    r = await runWith(
      [
        './absente.mjs',
        ...[
          'version2',
          'leve',
          'non-deterministe',
          'forme',
          'boucle',
          'regle-leve',
          'rapport-leve',
        ].map((f) => join(FAULTY, `${f}.mjs`)),
        join(EXAMPLES, 'iban', 'index.mjs'),
      ],
      5000,
    )
  })

  it('le run se termine normalement, les stratégies saines produisent leurs mutations', () => {
    expect(r.run.code, r.run.err).toBe(1)
    expect(iban(r.report)).toHaveLength(8)
    expect(r.report.mutations.every((m) => m.status !== null)).toBe(true)
    expect(r.run.err).toContain('PLUGIN_FAILURE')
  })

  it('chaque erreur classée PLUGIN_FAILURE avec sa phase et son code', () => {
    const f = r.report.plugins.failures.map(
      (x) => `${x.extension ?? x.plugin} ${x.phase} ${x.code}`,
    )
    expect(f).toEqual([
      './absente.mjs load NOT_FOUND',
      'futur load API_VERSION_INCOMPATIBLE',
      'leve/s plan THROWN',
      'nondet/s plan NON_DETERMINISTIC',
      'forme/s plan INVALID_SHAPE',
      'boucle/s plan TIMEOUT',
      'regle/r fuzz THROWN',
    ])
    expect(r.report.plugins.failures.every((x) => x.origin === 'PLUGIN_FAILURE')).toBe(true)
    // Aucune mutation d'une stratégie désactivée.
    expect(
      r.report.mutations.filter((m) => m.strategy.includes('/') && !m.strategy.startsWith('iban/')),
    ).toEqual([])
  })

  it('rapporteur qui lève : consigné au rapport suivant ; extensions en erreur marquées désactivées', () => {
    expect(existsSync(join(r.dir))).toBe(true)
    expect(readdirSync(r.dir)).toEqual([])
    const last = r.after.plugins.failures.at(-1)
    expect([last?.extension, last?.phase, last?.code]).toEqual(['rapport/r', 'report', 'THROWN'])
    const disabled = r.after.plugins.loaded.flatMap((p) =>
      p.extensions.filter((e) => e.disabled).map((e) => e.id),
    )
    expect(disabled).toEqual([
      'leve/s',
      'nondet/s',
      'forme/s',
      'boucle/s',
      'boucle/saine',
      'regle/r',
      'rapport/r',
    ])
    const leve = r.after.plugins.loaded.find((p) => p.name === 'leve')
    expect(leve?.extensions).toEqual([
      { kind: 'strategy', id: 'leve/s', disabled: true },
      { kind: 'rule', id: 'leve/saine', disabled: false },
    ])
  })
})
