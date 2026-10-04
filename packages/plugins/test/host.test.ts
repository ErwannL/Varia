// Hôte des extensions (runtime/host.cjs), chargé par `createRequire` (docs/notes/couverture.md) :
// aléa à graine identique au cœur, `Math.random` interdit pendant l'appel, réponses du protocole.
import { mulberry32 as coreMulberry32 } from '@varia/core'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MessageChannel, receiveMessageOnPort } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'

type Res = { ok: boolean; code?: string; message?: string; value?: unknown; mathRandom?: boolean }
interface Host {
  mulberry32(seed: number): () => number
  withoutMathRandom<T>(fn: () => T): { value: T; mathRandom: boolean }
  createHost(importer: (url: string) => Promise<unknown>): {
    handle(req: Record<string, unknown>): Promise<Res>
  }
  start(
    data: { port: unknown; signal: SharedArrayBuffer },
    importer?: (url: string) => Promise<unknown>,
  ): void
}
const H = createRequire(import.meta.url)('../runtime/host.cjs') as Host

const plugin = {
  apiVersion: 1,
  name: 'p',
  strategies: [
    {
      id: 's',
      supports: (i: { ok: unknown }) => i.ok,
      generate: (_i: unknown, ctx: { random: () => number; limits: unknown }) => [
        { value: ctx.random() },
        { value: ctx.limits },
      ],
    },
    { id: 'sans-generate', supports: () => true },
  ],
  formatDetectors: [
    { id: 'd', detect: (v: string) => v === 'x', invalidValues: (v: string) => [v + v] },
  ],
  oracleRules: [{ id: 'r', evaluate: (i: unknown) => ({ got: i }) }],
  reporters: [{ id: 'rep', extension: 'txt', render: (r: { n: number }) => `n=${String(r.n)}` }, 7],
}

const loaded = async (p: unknown = plugin) => {
  const host = H.createHost(() => Promise.resolve({ default: p }))
  const r = await host.handle({ op: 'load', url: 'file:///p.mjs' })
  return { host, r }
}

describe('hôte des extensions (runtime/host.cjs)', () => {
  it('mulberry32 : même suite que celui du cœur pour une même graine', () => {
    for (const seed of [0, 1, 42, 0xffffffff]) {
      const a = H.mulberry32(seed)
      const b = coreMulberry32(seed)
      expect(Array.from({ length: 20 }, a)).toEqual(Array.from({ length: 20 }, b))
    }
  })

  it('Math.random lève pendant l’appel, est signalé même rattrapé, puis restauré', () => {
    const random = () => Reflect.get(Math, 'random') as () => number
    const before = random()
    const r = H.withoutMathRandom(() => {
      try {
        random()()
      } catch (e) {
        return (e as Error).message
      }
      return 'non levé'
    })
    expect(r.value).toMatch(/^MATH_RANDOM_FORBIDDEN/)
    expect(r.mathRandom).toBe(true)
    expect(random()).toBe(before)
    expect(H.withoutMathRandom(() => 1)).toEqual({ value: 1, mathRandom: false })
    // Exception de l'extension : restauré aussi, l'exception porte le signalement.
    expect(() =>
      H.withoutMathRandom(() => {
        throw 'chaîne'
      }),
    ).toThrow('chaîne')
    expect(random()).toBe(before)
  })

  it('load : décrit le plugin (forme brute) ; module sans export par défaut accepté', async () => {
    const { r } = await loaded()
    expect(r).toEqual({
      ok: true,
      value: {
        apiVersion: 1,
        name: 'p',
        strategy: [
          { id: 's', extension: undefined },
          { id: 'sans-generate', extension: undefined },
        ],
        detector: [{ id: 'd', extension: undefined }],
        rule: [{ id: 'r', extension: undefined }],
        reporter: [{ id: 'rep', extension: 'txt' }, { id: undefined }],
      },
    })
    expect(r.ok && 'version' in (r.value as object)).toBe(true)
    expect((r.value as { version: unknown }).version).toBeUndefined()
    // Version : chaîne transmise, toute autre valeur présente ⇒ null (refusée par la session).
    for (const [v, out] of [
      ['1.0.0', '1.0.0'],
      [3, null],
      [() => '1', null],
    ] as const) {
      const h = H.createHost(() =>
        Promise.resolve({ default: { apiVersion: 1, name: 'v', version: v } }),
      )
      expect(
        ((await h.handle({ op: 'load', url: 'x' })).value as { version: unknown }).version,
      ).toBe(out)
    }
    const cjs = H.createHost(() => Promise.resolve({ apiVersion: 1, name: 'c', reporters: 'x' }))
    const d = await cjs.handle({ op: 'load', url: 'file:///c.cjs' })
    expect(d.value).toMatchObject({ name: 'c', strategy: [], reporter: [{ id: undefined }] })
  })

  it('load : export non objet ⇒ INVALID_SHAPE ; import qui lève ⇒ THROWN', async () => {
    expect((await loaded(42)).r).toMatchObject({ ok: false, code: 'INVALID_SHAPE' })
    const failing = H.createHost(() => Promise.reject(new SyntaxError('jeton')))
    expect(await failing.handle({ op: 'load', url: 'x' })).toEqual({
      ok: false,
      code: 'THROWN',
      message: 'SyntaxError: jeton',
      mathRandom: false,
    })
  })

  it('strategy : générateur à graine, null si non supportée, supports non booléen signalé', async () => {
    const { host } = await loaded()
    const r = await host.handle({
      op: 'strategy',
      id: 's',
      inputs: [{ ok: true }, { ok: false }, { ok: 'oui' }],
      seeds: [7, 7, 7],
      limits: { stringLength: 1 },
    })
    expect(r).toEqual({
      ok: true,
      mathRandom: false,
      value: [
        [{ value: H.mulberry32(7)() }, { value: { stringLength: 1 } }],
        null,
        { invalidSupports: true },
      ],
    })
    const missing = await host.handle({
      op: 'strategy',
      id: 'sans-generate',
      inputs: [{}],
      seeds: [1],
      limits: {},
    })
    expect(missing).toMatchObject({ ok: false, code: 'INVALID_SHAPE', mathRandom: false })
  })

  it('detector, rule, reporter : appels de la méthode du contrat', async () => {
    const { host } = await loaded()
    expect(await host.handle({ op: 'detector', id: 'd', values: ['x', 'y'] })).toMatchObject({
      ok: true,
      value: [['xx'], null],
    })
    expect(await host.handle({ op: 'rule', id: 'r', input: { a: 1 } })).toMatchObject({
      ok: true,
      value: { got: { a: 1 } },
    })
    expect(await host.handle({ op: 'reporter', id: 'rep', report: { n: 3 } })).toMatchObject({
      ok: true,
      value: 'n=3',
    })
  })

  it('start : réponse postée puis signalée ; valeur non clonable ⇒ INVALID_SHAPE', async () => {
    const { port1, port2 } = new MessageChannel()
    const signal = new SharedArrayBuffer(4)
    const flag = new Int32Array(signal)
    // Importeur par défaut : le vrai `import()` de Node (fixture chargée hors de Vite).
    H.start({ port: port2, signal })
    const ask = async (msg: Record<string, unknown>) => {
      Atomics.store(flag, 0, 0)
      port1.postMessage(msg)
      // Le port vit dans le même thread : on rend la main jusqu'au signal (jamais Atomics.wait ici).
      while (Atomics.load(flag, 0) === 0) await new Promise((r) => setTimeout(r, 5))
      return receiveMessageOnPort(port1)?.message as Res
    }
    const url = pathToFileURL(join(import.meta.dirname, 'fixtures', 'fautif.mjs')).href
    expect(await ask({ op: 'load', url })).toMatchObject({ ok: true, value: { name: 'fautif' } })
    expect(
      await ask({ op: 'strategy', id: 'forme-fonction', inputs: [{}], seeds: [1], limits: {} }),
    ).toMatchObject({ ok: false, code: 'INVALID_SHAPE', mathRandom: false })
    port1.close()
    port2.close()
  })
})
