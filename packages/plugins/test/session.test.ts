// Session d'extensions (X-02, X-03) : chargement, apiVersion, ordre et conflits d'identifiants,
// déterminisme, Math.random, plafonds, formes invalides, exceptions, boucles — jamais fatal.
import type { InputDescriptor } from '@varia/core'
import {
  candidatesOf,
  checkValue,
  loadPlugins,
  MAX_CANDIDATES_PER_INPUT,
  resolvePlugin,
  seedFor,
  type PluginSession,
} from '@varia/plugins'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const FIX = join(import.meta.dirname, 'fixtures')
const LIMITS = { stringLength: 50, arrayLength: 10, objectDepth: 4 }
const sessions: PluginSession[] = []
const open = (specifiers: string[], timeoutMs = 10_000, baseDir = FIX, root = FIX) => {
  const s = loadPlugins({ specifiers, baseDir, root, timeoutMs })
  sessions.push(s)
  return s
}
afterEach(() => {
  for (const s of sessions.splice(0)) s.close()
})

const input = (over: Partial<InputDescriptor> = {}): InputDescriptor => ({
  callSiteId: 'c_0000000000000001',
  testId: 't_1',
  module: 'src/m.js',
  export: 'f',
  depth: 0,
  sequence: 0,
  argsFingerprint: 'fp',
  path: ['0'],
  pathStr: 'arg0',
  type: 'number',
  original: 5,
  inObject: false,
  mutable: true,
  ...over,
})
const NUM = input()
const CP = input({ pathStr: 'arg1', path: ['1'], type: 'string', original: '75001' })

/** Échecs réduits à `extension code` (ordre conservé). */
const codes = (s: PluginSession) =>
  s.failures.map((f) => `${f.extension ?? f.plugin} ${f.phase} ${f.code}`)

describe('chargement des extensions', () => {
  it('ordre de la configuration, identifiants `<plugin>/<id>`, types dans un ordre fixe', () => {
    const s = open(['./complet.mjs', './cjs.cjs'])
    expect(s.failures).toEqual([])
    expect(s.summary().loaded).toEqual([
      {
        name: 'complet',
        specifier: './complet.mjs',
        apiVersion: 1,
        extensions: [
          { kind: 'strategy', id: 'complet/tirage', disabled: false },
          { kind: 'detector', id: 'complet/code-postal', disabled: false },
          { kind: 'rule', id: 'complet/code-validation', disabled: false },
          { kind: 'reporter', id: 'complet/compte', disabled: false, fileExtension: 'txt' },
        ],
      },
      { name: 'cjs', specifier: './cjs.cjs', apiVersion: 1, extensions: [] },
    ])
    expect(s.strategyIds()).toEqual(['complet/tirage', 'complet/code-postal'])
  })

  it('refus clairs : absente, version incompatible, forme, nom, doublon de plugin (le premier gagne)', () => {
    const syntax = join(mkdtempSync(join(tmpdir(), 'varia-plugin-')), 'syntaxe.mjs')
    writeFileSync(syntax, 'export default {\n')
    const s = open([
      './absent.mjs',
      'paquet-absent',
      './version2.mjs',
      './vide.mjs',
      './primitif.mjs',
      './sans-nom.mjs',
      './nom-nombre.mjs',
      './sans-nom-du-tout.mjs',
      syntax,
      './complet.mjs',
      './complet.mjs',
    ])
    expect(codes(s)).toEqual([
      './absent.mjs load NOT_FOUND',
      'paquet-absent load NOT_FOUND',
      'futur load API_VERSION_INCOMPATIBLE',
      './vide.mjs load API_VERSION_INCOMPATIBLE',
      './primitif.mjs load INVALID_SHAPE',
      'Nom Invalide load INVALID_SHAPE',
      './nom-nombre.mjs load INVALID_SHAPE',
      './sans-nom-du-tout.mjs load INVALID_SHAPE',
      `${syntax} load LOAD_ERROR`,
      'complet load DUPLICATE_ID',
    ])
    expect(s.failures[2]?.message).toBe('apiVersion 2 ; cette version de Varia accepte 1')
    expect(s.failures[3]?.message).toBe('apiVersion absente ; cette version de Varia accepte 1')
    expect(s.failures[6]?.message).toBe('nom invalide : 5')
    expect(s.failures[7]?.message).toBe('nom invalide : absent')
    expect(s.failures.every((f) => f.origin === 'PLUGIN_FAILURE')).toBe(true)
    expect(s.loaded.map((p) => p.name)).toEqual(['complet'])
  })

  it('extensions mal déclarées refusées une à une, les autres gardées', () => {
    const s = open(['./identifiants.mjs'])
    expect(codes(s)).toEqual([
      'identifiants/Majuscule load INVALID_SHAPE',
      'identifiants/double load DUPLICATE_ID',
      'identifiants/undefined load INVALID_SHAPE',
      'identifiants/undefined load INVALID_SHAPE',
      'identifiants/sans-ext load INVALID_SHAPE',
    ])
    expect(s.loaded[0]?.extensions.map((e) => e.id)).toEqual(['identifiants/double'])
  })

  it('paquet installé résolu depuis la racine du projet ; chemin absolu accepté', () => {
    const root = mkdtempSync(join(tmpdir(), 'varia-plugin-root-'))
    const pkg = join(root, 'node_modules', 'varia-plugin-demo')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, 'package.json'), '{"name":"varia-plugin-demo","main":"index.cjs"}')
    writeFileSync(join(pkg, 'index.cjs'), "module.exports = { apiVersion: 1, name: 'demo' }")
    expect(resolvePlugin('varia-plugin-demo', FIX, root)).toBe(join(pkg, 'index.cjs'))
    expect(resolvePlugin(join(FIX, 'vide.mjs'), '/ailleurs', root)).toBe(join(FIX, 'vide.mjs'))
    const s = open(['varia-plugin-demo'], 10_000, FIX, root)
    expect(s.loaded.map((p) => p.name)).toEqual(['demo'])
  })

  it('chargement qui boucle : délai borné, thread arrêté, PLUGIN_FAILURE TIMEOUT', () => {
    const s = open(['./chargement-boucle.mjs', './cjs.cjs'], 1500)
    expect(codes(s)).toEqual(['./chargement-boucle.mjs load TIMEOUT'])
    expect(s.loaded.map((p) => p.name)).toEqual(['cjs'])
  })

  it('aucune extension : session vide', () => {
    const s = open([])
    expect(s.summary()).toEqual({ loaded: [], failures: [] })
    expect(s.generate([NUM], 1, LIMITS).size).toBe(0)
    expect(s.applyRules({} as never)).toBeNull()
    expect(s.render({})).toEqual([])
  })
})

describe('stratégies externes', () => {
  it('générateur à graine : même graine ⇒ mêmes candidats ; graine différente ⇒ autres', () => {
    const s = open(['./complet.mjs'])
    const a = s.generate([NUM, CP], 42, LIMITS)
    expect(a.get('c_0000000000000001|arg0')).toEqual([
      { strategy: 'complet/tirage', op: 'set', value: expect.any(Number) as number },
      { strategy: 'complet/tirage', op: 'delete', value: null },
      { strategy: 'complet/tirage', op: 'set', value: 50 },
    ])
    expect(a.get('c_0000000000000001|arg1')).toEqual([
      { strategy: 'complet/code-postal', op: 'set', value: '5001' },
      { strategy: 'complet/code-postal', op: 'set', value: '750010' },
    ])
    expect(s.generate([NUM, CP], 42, LIMITS)).toEqual(a)
    const other = [42, 43, 44].map(
      (seed) => s.generate([NUM], seed, LIMITS).get('c_0000000000000001|arg0')?.[0]?.value,
    )
    expect(new Set(other).size).toBeGreaterThan(1)
    expect(s.failures).toEqual([])
  })

  it('graine par entrée indépendante de l’ordre du lot', () => {
    expect(seedFor(1, NUM, 'a/b')).toBe(seedFor(1, NUM, 'a/b'))
    expect(seedFor(1, NUM, 'a/b')).not.toBe(seedFor(1, CP, 'a/b'))
    const s = open(['./complet.mjs'])
    const both = s.generate([CP, NUM], 7, LIMITS).get('c_0000000000000001|arg0')
    expect(s.generate([NUM], 7, LIMITS).get('c_0000000000000001|arg0')).toEqual(both)
  })

  it('filtre `only` : seules les stratégies demandées sont appelées', () => {
    const s = open(['./complet.mjs'])
    const g = s.generate([NUM, CP], 1, LIMITS, ['complet/code-postal'])
    expect([...g.keys()]).toEqual(['c_0000000000000001|arg1'])
  })

  const fautive = (id: string, inputs = [NUM]) => {
    const s = open(['./fautif.mjs'])
    const g = s.generate(inputs, 1, LIMITS, [`fautif/${id}`])
    return { s, g, code: codes(s).join(' | ') }
  }

  it.each([
    ['leve', 'THROWN'],
    ['leve-second', 'THROWN'],
    ['non-deterministe', 'NON_DETERMINISTIC'],
    ['hasard', 'MATH_RANDOM_FORBIDDEN'],
    ['hasard-rattrape', 'MATH_RANDOM_FORBIDDEN'],
    ['forme-objet', 'INVALID_SHAPE'],
    ['forme-fonction', 'INVALID_SHAPE'],
    ['forme-date', 'INVALID_SHAPE'],
    ['nan', 'INVALID_SHAPE'],
    ['op-inconnue', 'INVALID_SHAPE'],
    ['sans-valeur', 'INVALID_SHAPE'],
    ['element-nul', 'INVALID_SHAPE'],
    ['supports-texte', 'INVALID_SHAPE'],
    ['sans-generate', 'INVALID_SHAPE'],
    ['trop-long', 'LIMIT_EXCEEDED'],
    ['trop-de-valeurs', 'LIMIT_EXCEEDED'],
    ['trop-profond', 'LIMIT_EXCEEDED'],
    ['tableau-long', 'LIMIT_EXCEEDED'],
    ['detecteur-objet', 'INVALID_SHAPE'],
    ['detecteur-nombres', 'INVALID_SHAPE'],
    ['detecteur-long', 'LIMIT_EXCEEDED'],
  ])('%s ⇒ PLUGIN_FAILURE %s, stratégie désactivée, aucun candidat', (id, code) => {
    const { s, g } = fautive(id, [NUM, CP])
    expect(codes(s)).toEqual([`fautif/${id} plan ${code}`])
    expect(g.size).toBe(0)
    expect(s.strategyIds()).not.toContain(`fautif/${id}`)
    expect(s.strategyIds()).toContain('fautif/boucle')
  })

  it('boucle synchrone infinie : interrompue au délai, tout le plugin désactivé, run poursuivi', () => {
    const s = open(['./fautif.mjs', './complet.mjs'], 3000)
    const g = s.generate([NUM], 1, LIMITS, ['fautif/boucle', 'complet/tirage'])
    expect(codes(s)).toEqual(['fautif/boucle plan TIMEOUT'])
    expect(s.strategyIds()).toEqual(['complet/tirage', 'complet/code-postal'])
    expect(g.get('c_0000000000000001|arg0')?.length).toBe(3)
    expect(s.applyRules({} as never)).toBeNull()
  })

  it('process.exit dans une extension : seul son thread s’arrête (TIMEOUT), Varia continue', () => {
    const s = open(['./sortie.mjs'], 1500)
    expect(s.generate([NUM], 1, LIMITS).size).toBe(0)
    expect(codes(s)).toEqual(['sortie/s plan TIMEOUT'])
    expect(process.exitCode ?? 0).toBe(0)
  })

  it('erreur non rattrapée dans le thread : le plugin ne répond plus, TIMEOUT, jamais fatal', async () => {
    const s = open(['./minuterie.mjs'])
    expect(s.failures).toEqual([])
    // Laisse l'événement `error` du thread parvenir au processus Varia.
    await new Promise((r) => setTimeout(r, 300))
    expect(s.generate([NUM], 1, LIMITS).size).toBe(0)
    expect(s.failures.map((f) => [f.code, f.message])).toEqual([['TIMEOUT', 'thread arrêté']])
  })
})

describe('validation des valeurs (contrat et plafonds durs)', () => {
  it('checkValue', () => {
    expect(checkValue({ $t: 'undefined' }, LIMITS)).toBeNull()
    expect(checkValue([true, null, 'a', 1.5, { a: [1] }], LIMITS)).toBeNull()
    expect(checkValue(Infinity, LIMITS)).toBe('INVALID_SHAPE')
    expect(checkValue(undefined, LIMITS)).toBe('INVALID_SHAPE')
    expect(checkValue(new Map(), LIMITS)).toBe('INVALID_SHAPE')
    expect(checkValue([[[[[1]]]]], LIMITS)).toBe('LIMIT_EXCEEDED')
    expect(checkValue({ a: 'x'.repeat(51) }, LIMITS)).toBe('LIMIT_EXCEEDED')
  })
  it('candidatesOf', () => {
    expect(candidatesOf([{ value: 1 }, { op: 'delete' }], 's', LIMITS)).toEqual([
      { strategy: 's', op: 'set', value: 1 },
      { strategy: 's', op: 'delete', value: null },
    ])
    expect(candidatesOf('x', 's', LIMITS)).toBe('INVALID_SHAPE')
    expect(candidatesOf([[1]], 's', LIMITS)).toBe('INVALID_SHAPE')
    expect(candidatesOf([{ value: 'x'.repeat(51) }], 's', LIMITS)).toBe('LIMIT_EXCEEDED')
    expect(
      candidatesOf(new Array(MAX_CANDIDATES_PER_INPUT).fill({ value: 1 }), 's', LIMITS),
    ).toHaveLength(MAX_CANDIDATES_PER_INPUT)
  })
})

const RULE_INPUT = {
  mutation: {
    id: 'm_1',
    target: 'src/m.js#f',
    path: 'arg0',
    strategy: 'null',
    op: 'set' as const,
    original: 1,
    value: null,
  },
  classification: { status: 'UNEXPECTED_FAILURE' as const, subtype: null, reason: null },
  outcome: {
    kind: 'throw',
    value: null,
    error: { name: 'Error', message: 'm', stack: '', code: 'E_VALIDATION', constructorChain: [] },
  },
  testStatus: 'failed',
}

describe('règles d’oracle et rapporteurs externes', () => {
  it('règles fautives désactivées une à une, puis la première règle conforme avec un avis gagne', () => {
    const s = open(['./fautif.mjs', './complet.mjs'])
    expect(s.applyRules(RULE_INPUT)).toEqual({
      status: 'HANDLED',
      reason: 'CODE_E_VALIDATION',
      rule: 'complet/code-validation',
    })
    expect(codes(s)).toEqual([
      'fautif/regle-leve fuzz THROWN',
      'fautif/regle-forme fuzz INVALID_SHAPE',
      'fautif/regle-raison fuzz INVALID_SHAPE',
      'fautif/regle-scalaire fuzz INVALID_SHAPE',
    ])
    expect(s.failures[0]?.message).toBe('Error: panne de règle')
    // Sans avis (`null`) : aucune décision, aucune erreur.
    expect(s.applyRules({ ...RULE_INPUT, outcome: { ...RULE_INPUT.outcome, error: null } })).toBe(
      null,
    )
    expect(s.failures).toHaveLength(4)
  })

  it('rapporteurs : rapport reçu, sortie texte ; sortie non textuelle ou exception ⇒ PLUGIN_FAILURE', () => {
    const s = open(['./fautif.mjs', './complet.mjs'])
    expect(s.render({ mutations: [1, 2] })).toEqual([
      { id: 'complet/compte', extension: 'txt', content: 'mutations=2\n' },
    ])
    expect(codes(s)).toEqual([
      'fautif/rendu-nombre report INVALID_SHAPE',
      'fautif/rendu-leve report THROWN',
    ])
    expect(s.failures[1]?.message).toBe('TypeError: panne de rendu')
    expect(s.render({ mutations: [] })).toHaveLength(1)
    expect(s.failures).toHaveLength(2)
  })

  it('message d’erreur borné à 500 caractères', () => {
    const dir = mkdtempSync(join(tmpdir(), 'varia-plugin-'))
    writeFileSync(
      join(dir, 'long.mjs'),
      "export default { apiVersion: 1, name: 'long', reporters: [{ id: 'r', extension: 'txt', render: () => { throw new Error('x'.repeat(2000)) } }] }",
    )
    const s = open(['./long.mjs'], 10_000, dir)
    s.render({})
    expect(s.failures[0]?.message).toHaveLength(500)
  })
})
