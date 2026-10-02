// B-02 : commandes d'exécution du CLI pilotées par un adapter scripté (aucun runner réel).
import type { TestAdapter } from '@varia/core'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scripted, type FakeTest } from '../../engine/test/fake.js'
import { runCli, type Io } from '../src/index.js'

const TESTS: FakeTest[] = [
  { name: 'a', calls: [{ export: 'f', args: [{ name: 'Ada' }] }] },
  { name: 'b', calls: [{ export: 'g', args: ['x'] }] },
]
const YML = "version: 1\nmutations: { seed: 3, per_input: 2, strategies: ['null', type] }\n"
const crashF = () =>
  scripted(TESTS, (m) =>
    m.export === 'f' ? { throws: { name: 'TypeError', message: 'boom' } } : { returns: m.value },
  )

function project(yml = YML): string {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'varia-runcmd-')))
  writeFileSync(join(d, 'varia.yml'), yml)
  return d
}

async function run(
  argv: string[],
  cwd: string,
  adapter: TestAdapter = crashF(),
  env: NodeJS.ProcessEnv = {},
) {
  const out: string[] = []
  const err: string[] = []
  const io: Io = { out: (l) => out.push(l), err: (l) => err.push(l) }
  const code = await runCli(['--data-dir', join(cwd, '.data'), ...argv], io, {
    env: { LANG: 'fr_FR.UTF-8', ...env },
    cwd,
    adapter: () => adapter,
  })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('baseline et plan', () => {
  it('baseline --json ; baseline en échec ⇒ code 2', async () => {
    const d = project()
    const j = await run(['--json', 'baseline'], d)
    expect(j.code).toBe(0)
    expect((JSON.parse(j.out) as { state: string }).state).toBe('BASELINE_DONE')
    const failing = scripted([{ name: 'a', status: 'failed', calls: [] }])
    expect((await run(['-q', 'baseline'], project(), failing)).code).toBe(2)
    // --allow-failing : la baseline est enregistrée et résumée, le code reste celui d'une baseline en échec.
    const allowed = await run(['baseline', '--allow-failing'], project(), failing)
    expect(allowed.code).toBe(2)
    expect(allowed.err).not.toContain('Erreur')
  })
  it('plan --changed <base> : base transmise (hors git : repli annoncé)', async () => {
    const r = await run(['plan', '--changed', 'main'], project())
    expect(r.code).toBe(0)
    expect(r.err).toContain('--changed : portée indéterminable')
  })
  it('plan sans baseline préalable (la lance), --out, --changed sans base, ciblage', async () => {
    const d = project()
    const r = await run(
      ['plan', '--out', 'plan.json', '--changed', '--function', 'f', '--seed', '5'],
      d,
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain(`Plan écrit : ${join(d, 'plan.json')}`)
    const plan = JSON.parse(readFileSync(join(d, 'plan.json'), 'utf8')) as {
      seed: number
      mutations: { export: string }[]
    }
    expect(plan.seed).toBe(5)
    expect(new Set(plan.mutations.map((m) => m.export))).toEqual(new Set(['f']))
  })
})

describe('fuzz', () => {
  it('sur un run planifié : pas de re-planification ; --plan importé ; --resume', async () => {
    const d = project()
    await run(['-q', 'plan', '--out', 'plan.json'], d)
    const planned = await run(['fuzz'], d)
    expect(planned.out).not.toContain('mutations retenues')
    expect(planned.code).toBe(1)
    const runId = /Run (r_[0-9a-z_]+)/.exec(planned.out)?.[1] ?? ''
    const resumed = await run(['fuzz', '--resume', runId], d)
    expect(resumed.out).toMatch(/^Reprise : 6 mutations déjà persistées/m)
    const d2 = project()
    await run(['-q', 'baseline'], d2)
    const imported = await run(['fuzz', '--plan', join(d, 'plan.json')], d2)
    expect(imported.out).toContain('6 mutations retenues sur 20 possibles')
  })
  it('--max-time 0 : run partiel annoncé', async () => {
    const r = await run(['fuzz', '--max-time', '0', '--no-cache'], project())
    expect(r.err).toMatch(/partiel/)
  })
})

describe('replay', () => {
  it('texte : statut, statut enregistré, environnement inchangé', async () => {
    const d = project()
    const fuzz = await run(['fuzz'], d)
    const id = /TypeError — boom .* varia replay (m_[0-9a-f]+)/.exec(fuzz.out)?.[1] ?? ''
    const r = await run(['replay', id], d)
    expect(r.code).toBe(0)
    expect(r.out).toContain(`${id}`)
    expect(r.out).toMatch(/CRASH/)
  })
  it('statut avec sous-type affiché (PASSED/SUSPICIOUS_ACCEPT)', async () => {
    const d = project()
    const fuzz = await run(['fuzz'], d)
    const id = /\] (m_[0-9a-f]+) → PASSED\/SUSPICIOUS_ACCEPT/.exec(fuzz.out)?.[1] ?? ''
    const r = await run(['replay', id], d)
    expect(r.out).toContain('→ PASSED/SUSPICIOUS_ACCEPT')
  })
})

describe('ci', () => {
  it('GITHUB_ACTIONS=true : annotations émises', async () => {
    const r = await run(['ci'], project(), crashF(), { GITHUB_ACTIONS: 'true' })
    expect(r.out).toMatch(/^::(error|warning) /m)
  })
})

/** Adapter qui simule un Ctrl+C pendant l'exécution du mode donné (observation ou mutation). */
function interrupting(mode: 'observe' | 'fuzz'): TestAdapter {
  const inner = crashF()
  return Object.assign(Object.create(inner) as TestAdapter, {
    run: async (o: Parameters<TestAdapter['run']>[0]) => {
      if (o.mode === mode) process.emit('SIGINT')
      return inner.run(o)
    },
  })
}

describe('interruption (Ctrl+C)', () => {
  it('fuzz : run marqué interrompu, code 130, reprise annoncée', async () => {
    const r = await run(['fuzz'], project(), interrupting('fuzz'))
    expect(r.code).toBe(130)
    expect(r.err).toMatch(/^Interrompu : .* --resume r_/m)
  })
  it('avant la création du run : rien à reprendre, aucune annonce', async () => {
    const r = await run(['fuzz'], project(), interrupting('observe'))
    expect(r.code).toBe(130)
    expect(r.err).not.toContain('Interrompu')
  })
  it('test : interrompu après la baseline', async () => {
    const r = await run(['test'], project(), interrupting('fuzz'))
    expect(r.code).toBe(130)
    expect(r.err).toContain('Interrompu')
  })
})

describe('replay : variantes', () => {
  it('jamais exécutée : pas de résultat enregistré ; --json', async () => {
    const d = project()
    await run(['-q', 'plan', '--out', 'plan.json'], d)
    const plan = JSON.parse(readFileSync(join(d, 'plan.json'), 'utf8')) as {
      mutations: { id: string }[]
    }
    const id = plan.mutations[0]?.id ?? ''
    const text = await run(['replay', id], d)
    expect(text.out).not.toContain('Résultat enregistré')
    const j = JSON.parse((await run(['--json', 'replay', id], d)).out) as { previous: unknown }
    expect(j.previous).toBeNull()
  })
  it('configuration modifiée depuis le run : ENVIRONMENT_CHANGED', async () => {
    const d = project()
    const fuzz = await run(['fuzz'], d)
    const id = /varia replay (m_[0-9a-f]+)/.exec(fuzz.out)?.[1] ?? ''
    writeFileSync(join(d, 'varia.yml'), `${YML}execution: { timeout_ms: 4000 }\n`)
    const r = await run(['replay', id], d)
    expect(r.out).toContain('Résultat enregistré : CRASH · identique : true')
    expect(r.err).toContain('ENVIRONMENT_CHANGED')
  })
})

describe('plan : estimation au-delà du seuil', () => {
  it('warn_after_ms dépassé ⇒ avertissement', async () => {
    const r = await run(['plan'], project(`${YML}execution: { warn_after_ms: 0 }\n`))
    expect(r.code).toBe(0)
    expect(r.err).toContain("l'estimation dépasse le seuil d'alerte")
  })
})
