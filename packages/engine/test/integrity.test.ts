// B-01 : contrôle d'intégrité du projet (CDC §5) dans CHAQUE point d'entrée qui lance le projet.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  doctor,
  EngineContext,
  planRun,
  replayMutation,
  runBaseline,
  runFuzz,
  VariaError,
} from '../src/index.js'
import { FakeAdapter, fuzzRun, observeRun, project, type Script } from './fake.js'

const TESTS = [{ name: 'crée', calls: [{ args: [{ name: 'Ada' }] }] }]
const YML = "version: 1\nmutations: { seed: 1, per_input: 1, strategies: ['null'] }\n"

/** Adapter qui écrit `file` dans le projet pendant certaines exécutions. */
function writing(root: string, file: string, when: (mode: string) => boolean): FakeAdapter {
  const script: Script = (o) => {
    if (when(o.mode)) {
      mkdirSync(join(root, file, '..'), { recursive: true })
      writeFileSync(join(root, file), `fuite ${o.runDir}`)
    }
    return o.mode === 'observe' ? observeRun(TESTS) : fuzzRun(o)
  }
  return new FakeAdapter(script)
}

const ctxOf = (root: string, adapter: FakeAdapter, dataDir = join(root, '.data')) =>
  new EngineContext({ root, adapter, dataDir })

async function rejects(p: Promise<unknown>): Promise<VariaError> {
  try {
    await p
  } catch (e) {
    return e as VariaError
  }
  throw new Error('PROJECT_MUTATED attendu')
}

const git = (root: string) => {
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], {
    cwd: root,
  })
}

describe('intégrité du projet (B-01)', () => {
  it('baseline : run marqué PROJECT_MUTATED AVANT l’erreur, fichiers listés', async () => {
    const root = project(YML)
    const ctx = ctxOf(
      root,
      writing(root, 'src/leak.txt', (m) => m === 'observe'),
    )
    const e = await rejects(runBaseline(ctx))
    expect([e.kind, e.details]).toEqual(['PROJECT_MUTATED', ['src/leak.txt']])
    const run = ctx.reader.listRuns(1)[0]
    expect(run?.state).toBe('PROJECT_MUTATED')
    expect(run?.info['projectMutated']).toEqual(['src/leak.txt'])
    expect(ctx.reader.events(run?.id ?? '', 'PROJECT_MUTATED')).toHaveLength(1)
    ctx.close()
  })
  it('fuzz : run marqué, exclu des références de comparaison suivantes', async () => {
    const root = project(YML)
    let leak = true
    const adapter = new FakeAdapter((o) => {
      if (o.mode === 'fuzz' && leak) writeFileSync(join(root, 'leak.txt'), o.runDir)
      return o.mode === 'observe'
        ? observeRun(TESTS)
        : fuzzRun(o, () => ({ throws: { name: 'TypeError' } }))
    })
    const ctx = ctxOf(root, adapter)
    const a = await runBaseline(ctx)
    planRun(ctx, a.runId)
    expect((await rejects(runFuzz(ctx, a.runId))).kind).toBe('PROJECT_MUTATED')
    expect(ctx.reader.getRun(a.runId)?.state).toBe('PROJECT_MUTATED')
    leak = false
    const b = await runBaseline(ctx)
    planRun(ctx, b.runId)
    await runFuzz(ctx, b.runId)
    // Comparé à aucun run (le seul précédent a modifié le projet) : issue NEW, pas UNCHANGED.
    expect(ctx.reader.getRun(b.runId)?.info['comparedTo']).toBeUndefined()
    expect(ctx.reader.issues(b.runId).map((i) => i.state)).toEqual(['NEW'])
    ctx.close()
  })
  it('doctor et replay sont gardés aussi', async () => {
    const root = project(YML)
    const ctx = ctxOf(
      root,
      writing(root, 'x.txt', (m) => m === 'fuzz'),
    )
    expect((await rejects(doctor(ctx))).kind).toBe('PROJECT_MUTATED')
    ctx.close()
    const root2 = project(YML)
    let leak = false
    const adapter = new FakeAdapter((o) => {
      if (leak) writeFileSync(join(root2, 'y.txt'), o.runDir)
      return o.mode === 'observe' ? observeRun(TESTS) : fuzzRun(o)
    })
    const c2 = ctxOf(root2, adapter)
    const b = await runBaseline(c2)
    const plan = planRun(c2, b.runId)
    leak = true
    const id = (
      JSON.parse(readFileSync(plan.planPath, 'utf8')) as {
        mutations: { id: string }[]
      }
    ).mutations[0]?.id
    expect((await rejects(replayMutation(c2, id ?? ''))).kind).toBe('PROJECT_MUTATED')
    expect(c2.reader.getRun(b.runId)?.state).toBe('PLANNED')
    c2.close()
  })
  it('git : écriture dans un dossier DÉJÀ non suivi détectée (-uall)', async () => {
    const root = project(YML)
    mkdirSync(join(root, 'out'))
    git(root)
    writeFileSync(join(root, 'out', 'existing.txt'), 'avant le run')
    const ctx = ctxOf(
      root,
      writing(root, 'out/new.txt', (m) => m === 'observe'),
      join(root, '..', 'data-' + String(Date.now())),
    )
    const e = await rejects(runBaseline(ctx))
    expect(e.details).toEqual(['out/new.txt'])
    ctx.close()
  })
  it('git : ignore_for_integrity appliqué (dist/ ignoré, pas de faux positif)', async () => {
    const root = project(`${YML}integrity: { ignore_for_integrity: [dist] }\n`)
    git(root)
    const ctx = ctxOf(
      root,
      writing(root, 'dist/bundle.js', (m) => m === 'observe'),
      join(root, '..', 'data-' + String(Date.now())),
    )
    expect((await runBaseline(ctx)).state).toBe('BASELINE_DONE')
    ctx.close()
  })
  it('hors git : le stockage de Varia dans le projet (.varia/) n’est pas une modification', async () => {
    const root = project(`${YML}storage: { location: project }\n`)
    const ctx = new EngineContext({ root, adapter: writing(root, 'never', () => false) })
    expect(ctx.dataDir).toBe(join(root, '.varia'))
    expect((await runBaseline(ctx)).state).toBe('BASELINE_DONE')
    ctx.close()
  })
})
