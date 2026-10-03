// Gabarits `varia scaffold strategy|rule|reporter <nom>` (T-02) : extension au contrat de
// @varia/plugins (apiVersion 1, identifiants `<nom>/<id>`), testée par @varia/testkit comme Varia
// l'exécute. Contenu fixe : aucune date, aucun chemin absolu (même entrée ⇒ mêmes octets).
import { common, type Names } from './common.js'

export type PluginKind = 'strategy' | 'rule' | 'reporter'

const HEADER = `// @ts-check
/** @typedef {import('@varia/plugins').VariaPlugin} VariaPlugin */
`

const strategy = (
  n: Names,
) => `// Stratégie de mutation « ${n.name}/variants » : variantes d'une chaîne non vide. Seul aléa permis :
// ctx.random (mulberry32 semé par Varia) — jamais Math.random. Même entrée, même graine ⇒ même sortie.
${HEADER}
/**
 * Un caractère retiré à une position tirée au sort, la chaîne doublée (bornée par la longueur
 * maximale) et la chaîne vide ; jamais la valeur d'origine.
 * @param {string} s
 * @param {() => number} random
 * @param {number} maxLength
 * @returns {string[]}
 */
export function variants(s, random, maxLength) {
  const at = Math.floor(random() * s.length)
  const out = [s.slice(0, at) + s.slice(at + 1), (s + s).slice(0, maxLength), '']
  return [...new Set(out)].filter((v) => v !== s)
}

/** @type {VariaPlugin} */
export default {
  apiVersion: 1,
  name: '${n.name}',
  strategies: [
    {
      id: 'variants',
      supports: (input) =>
        input.type === 'string' && typeof input.original === 'string' && input.original !== '',
      generate: (input, ctx) =>
        variants(String(input.original), ctx.random, ctx.limits.stringLength).map((value) => ({
          value,
        })),
    },
  ],
}
`

const rule = (
  n: Names,
) => `// Règle d'oracle « ${n.name}/invalid-input-code » : une erreur de code E_INVALID_INPUT est un refus
// propre (HANDLED). Sans avis (null) sinon : l'oracle intégré décide.
${HEADER}
/** @type {VariaPlugin} */
export default {
  apiVersion: 1,
  name: '${n.name}',
  oracleRules: [
    {
      id: 'invalid-input-code',
      evaluate: (input) =>
        input.outcome.error?.code === 'E_INVALID_INPUT'
          ? { status: 'HANDLED', reason: 'INVALID_INPUT_CODE' }
          : null,
    },
  ],
}
`

const reporter = (
  n: Names,
) => `// Rapporteur « ${n.name}/summary » : nombre de mutations par statut, calculé depuis le rapport JSON
// (déjà masqué). Écrit par \`varia report --extensions-dir <dossier>\` dans ${n.name}.summary.txt.
${HEADER}
/**
 * Lignes « STATUT nombre », triées par statut.
 * @param {Readonly<Record<string, unknown>>} report
 * @returns {string}
 */
export function summary(report) {
  const mutations = Array.isArray(report['mutations']) ? report['mutations'] : []
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const m of mutations) {
    const status = String(m?.status ?? 'UNKNOWN')
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  return [...counts.keys()]
    .sort()
    .map((status) => status + ' ' + String(counts.get(status)) + '\\n')
    .join('')
}

/** @type {VariaPlugin} */
export default {
  apiVersion: 1,
  name: '${n.name}',
  reporters: [{ id: 'summary', extension: 'txt', render: summary }],
}
`

const TEST_HEAD = `import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const BASE = fileURLToPath(new URL('..', import.meta.url))
const PLUGIN = './src/index.mjs'
`

const strategyTest = (
  n: Names,
) => `// Charge l'extension par @varia/testkit (même chargement et mêmes contrôles qu'un run de Varia).
import { assertDeterministic, callSite, generateWith, inputAt, inputsOf } from '@varia/testkit'
${TEST_HEAD}const STRATEGY = '${n.name}/variants'
const call = callSite({
  module: 'src/users.js',
  export: 'createUser',
  args: [{ name: 'Ada', age: 36 }],
})
const KEY = call.callSiteId + '|arg0.name'

describe('stratégie ${n.name}/variants', () => {
  it('ne mute que les chaînes, sans proposer la valeur d’origine', () => {
    const r = generateWith({
      plugin: PLUGIN,
      baseDir: BASE,
      strategy: STRATEGY,
      inputs: inputsOf(call),
    })
    expect(r.failures).toEqual([])
    expect([...r.candidates.keys()]).toEqual([KEY])
    const values = (r.candidates.get(KEY) ?? []).map((c) => c.value)
    expect(values).toHaveLength(3)
    expect(values).toContain('AdaAda')
    expect(values).toContain('')
    expect(values).not.toContain('Ada')
  })

  it('déterministe : deux sessions, même graine ⇒ mêmes candidats', () => {
    const candidates = assertDeterministic({
      plugin: PLUGIN,
      baseDir: BASE,
      strategy: STRATEGY,
      seed: 42,
      inputs: [inputAt(call, 'arg0.name')],
    })
    expect(candidates.get(KEY)).toHaveLength(3)
  })
})
`

const ruleTest = (
  n: Names,
) => `// Charge l'extension par @varia/testkit (même chargement et mêmes contrôles qu'un run de Varia).
import { evaluateRules, serializedError } from '@varia/testkit'
import type { OracleRuleInput } from '@varia/plugins'
${TEST_HEAD}
const inputWith = (error: Error & { code?: string }): OracleRuleInput => ({
  mutation: {
    id: 'm_1',
    target: 'src/users.js#createUser',
    path: 'arg0.name',
    strategy: 'null',
    op: 'set',
    original: 'Ada',
    value: null,
  },
  classification: { status: 'UNEXPECTED_FAILURE', subtype: null, reason: null },
  outcome: { kind: 'throw', value: null, error: serializedError(error) },
  testStatus: 'failed',
})

describe('règle ${n.name}/invalid-input-code', () => {
  it('code E_INVALID_INPUT ⇒ HANDLED', () => {
    const error = Object.assign(new Error('nom requis'), { code: 'E_INVALID_INPUT' })
    const r = evaluateRules({ plugin: PLUGIN, baseDir: BASE, input: inputWith(error) })
    expect(r.failures).toEqual([])
    expect(r.verdict).toEqual({
      status: 'HANDLED',
      reason: 'INVALID_INPUT_CODE',
      rule: '${n.name}/invalid-input-code',
    })
  })

  it('autre erreur : sans avis', () => {
    const r = evaluateRules({ plugin: PLUGIN, baseDir: BASE, input: inputWith(new TypeError('x')) })
    expect(r).toEqual({ verdict: null, failures: [] })
  })
})
`

const reporterTest = (
  n: Names,
) => `// Charge l'extension par @varia/testkit (même chargement et mêmes contrôles qu'un run de Varia).
import { renderWith } from '@varia/testkit'
${TEST_HEAD}
describe('rapporteur ${n.name}/summary', () => {
  it('compte les mutations par statut', () => {
    const report = { mutations: [{ status: 'CRASH' }, { status: 'HANDLED' }, { status: 'CRASH' }] }
    const r = renderWith({ plugin: PLUGIN, baseDir: BASE, report })
    expect(r.failures).toEqual([])
    expect(r.outputs.map((o) => [o.id, o.extension, o.content])).toEqual([
      ['${n.name}/summary', 'txt', 'CRASH 2\\nHANDLED 1\\n'],
    ])
  })

  it('rapport sans mutations : texte vide', () => {
    const r = renderWith({ plugin: PLUGIN, baseDir: BASE, report: {} })
    expect(r.outputs.map((o) => o.content)).toEqual([''])
  })
})
`

const SOURCES: Record<PluginKind, (n: Names) => string> = { strategy, rule, reporter }
const TESTS: Record<PluginKind, (n: Names) => string> = {
  strategy: strategyTest,
  rule: ruleTest,
  reporter: reporterTest,
}
const LABELS: Record<PluginKind, string> = {
  strategy: 'Stratégie de mutation',
  rule: 'Règle d’oracle',
  reporter: 'Rapporteur',
}

const packageJson = (n: Names) => `{
  "name": "varia-plugin-${n.name}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.mjs",
  "exports": {
    ".": "./src/index.mjs"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "20.19.43",
    "@varia/plugins": "0.1.0",
    "@varia/testkit": "0.1.0",
    "typescript": "5.9.3",
    "vitest": "3.2.7"
  }
}
`

const readme = (kind: PluginKind, n: Names) => `# varia-plugin-${n.name}

${LABELS[kind]} Varia générée par \`varia scaffold ${kind} ${n.name}\` (contrat \`@varia/plugins\`,
\`apiVersion: 1\`).

- \`src/index.mjs\` — le module d'extension (export par défaut, JavaScript vérifié par \`tsc\`).
- \`test/plugin.test.ts\` — chargé par \`@varia/testkit\`, comme dans un run de Varia.

\`\`\`bash
npm install
npm run typecheck
npm test
\`\`\`

Déclaration dans le projet à tester :

\`\`\`yaml
# varia.yml
plugins:
  - ./chemin/vers/${n.name}/src/index.mjs
\`\`\`
`

const VITEST_CONFIG = `import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
`

/** Fichiers du squelette d'extension (chemin relatif POSIX → contenu). */
export function pluginFiles(kind: PluginKind, n: Names): Record<string, string> {
  return {
    ...common(),
    'README.md': readme(kind, n),
    'package.json': packageJson(n),
    'vitest.config.ts': VITEST_CONFIG,
    'src/README.md': '# src/\n\nModule d’extension.\n',
    'src/index.mjs': SOURCES[kind](n),
    'test/README.md': '# test/\n\nTests de l’extension par @varia/testkit.\n',
    'test/plugin.test.ts': TESTS[kind](n),
  }
}
