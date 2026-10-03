// C-01 : rapprochement d'issues par empreinte secondaire (CDC §20.2-20.3) dans `analyze`, avec
// l'adaptateur scripté : déplacement de ligne, renommage de fonction, deux candidats.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planRun, runBaseline, runFuzz, sourceLine } from '../src/index.js'
import { FakeAdapter, context, fuzzRun, observeRun, type FakeTest } from './fake.js'

const YML = "version: 1\nmutations: { seed: 2, per_input: 1, strategies: ['null'] }\n"
const call = (exp: string) => ({ export: exp, args: [{ name: 'Ada' }] })

/** Projet scripté dont on change les tests, la source et la ligne qui lève entre deux runs. */
function setup() {
  const state = { tests: [] as FakeTest[], line: 2 }
  let root = ''
  const adapter = new FakeAdapter((o) =>
    o.mode === 'observe'
      ? observeRun(state.tests)
      : fuzzRun(o, (m) => ({
          throws: {
            name: 'TypeError',
            message: 'boom',
            stack: [
              'TypeError: boom',
              `    at ${m.export} (${root}/src/a.js:${String(state.line)}:9)`,
              `    at Object.<anonymous> (${root}/tests/a.test.js:3:1)`,
            ].join('\n'),
          },
        })),
  )
  const ctx = context(adapter, YML)
  root = ctx.root
  mkdirSync(join(root, 'src'))
  const source = (lines: string[]) => writeFileSync(join(root, 'src', 'a.js'), lines.join('\n'))
  const run = async () => {
    const b = await runBaseline(ctx)
    planRun(ctx, b.runId)
    await runFuzz(ctx, b.runId)
    return ctx.reader.issues(b.runId)
  }
  return { ctx, state, source, run }
}

const THROW = '  if (!u.age) throw new TypeError("boom")'

describe('rapprochement par empreinte secondaire (C-01)', () => {
  it('déplacement de ligne : même issue reconnue (UNCHANGED, rapprochée), l’ancienne n’est pas FIXED', async () => {
    const { ctx, state, source, run } = setup()
    state.tests = [{ name: 'a', calls: [call('f')] }]
    source(['function f(u) {', THROW, '}'])
    const [first] = await run()
    expect(first?.state).toBe('NEW')
    expect(first?.secondary).toMatchObject({
      module: 'src/a.js',
      stackFiles: ['src/a.js', 'tests/a.test.js'],
    })
    source(['// en-tête ajouté', '', 'function f(u) {', THROW, '}'])
    state.line = 4
    const second = await run()
    expect(second).toHaveLength(1)
    expect(second[0]?.id).not.toBe(first?.id)
    expect(second[0]).toMatchObject({ state: 'UNCHANGED', matchedFrom: [first?.id] })
    ctx.close()
  })
  it('renommage de fonction : rapprochée par empreinte secondaire (UNCHANGED, matchedFrom)', async () => {
    const { ctx, state, source, run } = setup()
    source(['function f(u) {', THROW, '}'])
    state.tests = [{ name: 'a', calls: [call('f')] }]
    const [first] = await run()
    source(['function createUser(u) {', THROW, '}'])
    state.tests = [{ name: 'a', calls: [call('createUser')] }]
    const second = await run()
    expect(second.map((i) => [i.target, i.state, i.matchedFrom])).toEqual([
      ['src/a.js#createUser', 'UNCHANGED', [first?.id]],
    ])
    ctx.close()
  })
  it('extrait de code modifié : pas de rapprochement (NEW + FIXED, aucune fausse certitude)', async () => {
    const { ctx, state, source, run } = setup()
    source(['function f(u) {', THROW, '}'])
    state.tests = [{ name: 'a', calls: [call('f')] }]
    const [first] = await run()
    source(['function f(u) {', '  u.check()', '  throw new TypeError("boom")', '}'])
    state.line = 3
    const second = await run()
    const old = second.find((i) => i.id === first?.id)
    const fresh = second.find((i) => i.id !== first?.id)
    expect(old).toMatchObject({ state: 'FIXED', count: 0 })
    expect(fresh).toMatchObject({ state: 'NEW', matchedFrom: [] })
    ctx.close()
  })
  it('deux candidats plausibles : AMBIGUOUS_MATCH, aucune fusion, candidats UNKNOWN', async () => {
    const { ctx, state, source, run } = setup()
    source(['function check(u) {', THROW, '}'])
    state.tests = [{ name: 'a', calls: [call('f'), call('g')] }]
    const before = await run()
    expect(before.map((i) => i.target).sort()).toEqual(['src/a.js#f', 'src/a.js#g'])
    state.tests = [{ name: 'a', calls: [call('h')] }]
    const after = await run()
    const current = after.find((i) => i.count > 0)
    expect(current).toMatchObject({ target: 'src/a.js#h', state: 'AMBIGUOUS_MATCH' })
    expect([...(current?.matchedFrom ?? [])].sort()).toEqual(before.map((i) => i.id).sort())
    expect(after.filter((i) => i.count === 0).map((i) => i.state)).toEqual(['UNKNOWN', 'UNKNOWN'])
    ctx.close()
  })
})

describe('lecture des lignes de source (empreinte secondaire)', () => {
  it('fichier relatif lu une fois ; hors projet, absent ou ligne hors fichier ⇒ null', () => {
    const { ctx, source } = setup()
    source(['a', 'b'])
    const read = sourceLine(ctx.root)
    expect(read('src/a.js', 2)).toBe('b')
    expect(read('src/a.js', 9)).toBeNull()
    expect(read('src/absent.js', 1)).toBeNull()
    expect(read('src/absent.js', 1)).toBeNull()
    expect(read(join(ctx.root, 'src/a.js'), 1)).toBeNull()
    expect(read('../x.js', 1)).toBeNull()
    ctx.close()
  })
})
