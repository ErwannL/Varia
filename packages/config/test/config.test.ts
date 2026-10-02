import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  jsonSchema,
  loadConfig,
  printableConfig,
  resolveConfig,
} from '../src/index.js'

const dir = (files: Record<string, string> = {}) => {
  const d = mkdtempSync(join(tmpdir(), 'varia-cfg-'))
  for (const [f, c] of Object.entries(files)) writeFileSync(join(d, f), c)
  return d
}

describe('chargement', () => {
  it('sans fichier : défauts (mode normal)', () => {
    const c = loadConfig(dir())
    expect(c.file).toBeNull()
    expect([c.perInput, c.stabilityRuns, c.strategies.length]).toEqual([10, 2, 9])
    expect(c.parsed.targets.include).toEqual(['src/**'])
    expect(c.parsed.execution.timeout_ms).toBe(5000)
    expect(c.handledErrors).toContain('ValidationError')
  })
  it('annexe A (configuration minimale) acceptée', () => {
    const yml =
      'version: 1\nproject: { name: my-api }\ntest: { command: npm test, framework: jest }\ntargets: { mode: auto, include: ["src/**"] }\nmutations: { mode: normal }\noracle:\n  handled_errors: [{ name: ValidationError }, { name: ZodError }]\n'
    expect(loadConfig(dir({ 'varia.yml': yml })).projectName).toBe('my-api')
  })
  it('modes quick et full, surcharge', () => {
    const quick = loadConfig(dir({ 'varia.yml': 'version: 1\nmutations: { mode: quick }\n' }))
    expect([quick.perInput, quick.stabilityRuns, quick.strategies]).toEqual([
      3,
      1,
      ['type', 'null', 'empty'],
    ])
    expect(loadConfig(dir(), { mode: 'full' }).perInput).toBe(20)
    expect(
      loadConfig(dir({ 'varia.json': '{"version":1,"mutations":{"per_input":7}}' })).perInput,
    ).toBe(7)
  })
  it('règles handled_errors : noms seuls et règles composées', () => {
    const c = resolveConfig(
      {
        version: 1,
        oracle: {
          handled_errors: [
            { name: 'BadRequest' },
            { code: 'E1' },
            { name: 'X', message: '^m' },
            { name_pattern: '^Y' },
            { status: 400 },
          ],
        },
      },
      '/p',
      null,
    )
    expect(c.handledErrors).toContain('BadRequest')
    expect(c.handledRules).toEqual([
      { code: 'E1' },
      { name: 'X', message: '^m' },
      { namePattern: '^Y' },
      { status: 400 },
    ])
  })
  it('acceptances : liste abrégée et forme { store, items }', () => {
    const item = { mutation_pattern: { function: 'f' }, reason: 'r' }
    expect(() => resolveConfig({ version: 1, acceptances: [item] }, '/p', null)).not.toThrow()
    expect(() =>
      resolveConfig({ version: 1, acceptances: { store: 'file', items: [item] } }, '/p', null),
    ).not.toThrow()
  })
})

describe('erreurs (code de sortie 3)', () => {
  it.each([
    [{ version: 2 }, 'version'],
    [{ version: 1, execution: { timeout_ms: 10 ** 9 } }, 'execution.timeout_ms'],
    [
      { version: 1, mutations: { limits: { string_length: 10 ** 8 } } },
      'mutations.limits.string_length',
    ],
    [{ version: 1, mutations: { strategies: ['semantic'] } }, 'mutations.strategies.0'],
    [{ version: 1, execution: { parallelism: 4 } }, 'execution.parallelism'],
  ])('%j refusé', (raw, path) => {
    try {
      resolveConfig(raw, '/p', null)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      expect((e as ConfigError).issues.join('\n')).toContain(path)
    }
  })
  it('deux fichiers de configuration', () => {
    expect(() =>
      loadConfig(dir({ 'varia.yml': 'version: 1\n', 'varia.json': '{"version":1}' })),
    ).toThrow(/plusieurs/)
  })
  it('fichier de configuration hors du projet (--config)', () => {
    const outside = dir({ 'other.yml': 'version: 1\nmutations: { mode: quick }\n' })
    const c = loadConfig(dir({ 'varia.yml': 'version: 1\n' }), { file: join(outside, 'other.yml') })
    expect([c.file, c.perInput]).toEqual([join(outside, 'other.yml'), 3])
    expect(() => loadConfig(dir(), { file: join(outside, 'absent.yml') })).toThrow(/introuvable/)
  })
  it('YAML illisible', () => {
    expect(() => loadConfig(dir({ 'varia.yml': 'version: [1\n' }))).toThrow(/illisible/)
  })
})

describe('affichage et schéma', () => {
  it('empreinte stable et sensible au contenu', () => {
    expect(resolveConfig({ version: 1 }, '/p', null).hash).toBe(
      resolveConfig({ version: 1 }, '/p', null).hash,
    )
    expect(resolveConfig({ version: 1, mutations: { seed: 1 } }, '/p', null).hash).not.toBe(
      resolveConfig({ version: 1 }, '/p', null).hash,
    )
  })
  it('--print masque les variables sensibles', () => {
    const out = printableConfig(
      resolveConfig(
        { version: 1, test: { env: { API_TOKEN: 'abc123', NODE_ENV: 'test' } } },
        '/p',
        null,
      ),
    )
    expect(out).not.toContain('abc123')
    expect(out).toContain('API_TOKEN: "***"')
    expect(out).toContain('NODE_ENV: test')
  })
  it('schema/varia.schema.json est à jour', () => {
    const onDisk = readFileSync(new URL('../schema/varia.schema.json', import.meta.url), 'utf8')
    expect(JSON.parse(onDisk)).toEqual(JSON.parse(JSON.stringify(jsonSchema())))
  })
})

describe('accepté = implémenté (A-06)', () => {
  const issues = (raw: object) => {
    try {
      resolveConfig({ version: 1, ...raw }, '/p', null)
      return []
    } catch (e) {
      return (e as ConfigError).issues
    }
  }
  it.each([
    [{ mutations: { combine: true } }, 'mutations.combine : UNSUPPORTED_COMBINE'],
    [{ execution: { parallelism: 2 } }, 'execution.parallelism : UNSUPPORTED_PARALLELISM'],
    [{ execution: { isolation: 'batch' } }, 'execution.isolation : UNSUPPORTED_ISOLATION'],
    [
      { execution: { reset: { environment: false } } },
      'execution.reset.environment : UNSUPPORTED_RESET_ENVIRONMENT',
    ],
    [{ execution: { reset: { mocks: false } } }, 'execution.reset.mocks : UNSUPPORTED_RESET_MOCKS'],
    [
      { execution: { reset: { filesystem: 'copy' } } },
      'execution.reset.filesystem : UNSUPPORTED_RESET_FILESYSTEM_COPY',
    ],
    [
      { execution: { reset: { database: 'command' } } },
      'execution.reset.database_command : DATABASE_COMMAND_REQUIRED',
    ],
    [
      { execution: { reset: { database: 'command', database_command: '  ' } } },
      'DATABASE_COMMAND_REQUIRED',
    ],
    [
      { redaction: { store_raw_values: true } },
      'redaction.store_raw_values : UNSUPPORTED_STORE_RAW_VALUES',
    ],
  ])('%j refusé avec un code explicite', (raw, issue) => {
    expect(issues(raw).join('\n')).toContain(issue)
  })
  it('document qui n’est pas une table : erreur à la racine', () => {
    expect(() => resolveConfig([1] as never, '/p', null)).toThrow(ConfigError)
    try {
      resolveConfig([1] as never, '/p', null)
    } catch (e) {
      expect((e as ConfigError).issues[0]).toMatch(/^\(racine\) : /)
    }
  })
  it('valeurs implémentées acceptées', () => {
    expect(
      issues({ execution: { reset: { environment: true, mocks: true, filesystem: 'tmpdir' } } }),
    ).toEqual([])
    expect(issues({ execution: { reset: { filesystem: 'none', database: 'none' } } })).toEqual([])
    const c = resolveConfig(
      { version: 1, execution: { reset: { database: 'command', database_command: 'make reset' } } },
      '/p',
      null,
    )
    expect(c.parsed.execution.reset).toEqual({
      environment: true,
      mocks: true,
      database: 'command',
      database_command: 'make reset',
      filesystem: 'none',
    })
    expect(issues({ execution: { reset: { filesystem: 'other' } } }).join('\n')).toContain(
      'execution.reset.filesystem : Invalid option',
    )
  })
})

describe('clés inconnues : avertissement, pas erreur (B-05, CDC §5.3)', () => {
  it('ignorées et listées ; la configuration reste valide', () => {
    const c = resolveConfig(
      { version: 1, extra: 1, execution: { timeout_ms: 1000, bidule: true }, test: { truc: 'x' } },
      '/p',
      null,
    )
    expect(c.warnings).toEqual([
      'execution.bidule : UNKNOWN_KEY',
      'extra : UNKNOWN_KEY',
      'test.truc : UNKNOWN_KEY',
    ])
    expect(c.parsed.execution.timeout_ms).toBe(1000)
    expect(c.hash).toBe(
      resolveConfig({ version: 1, execution: { timeout_ms: 1000 } }, '/p', null).hash,
    )
    expect(resolveConfig({ version: 1 }, '/p', null).warnings).toEqual([])
  })
  it('une valeur invalide reste une erreur (exit 3), même avec une clé inconnue', () => {
    expect(() =>
      resolveConfig({ version: 1, extra: 1, execution: { timeout_ms: 1 } }, '/p', null),
    ).toThrow(ConfigError)
  })
})
