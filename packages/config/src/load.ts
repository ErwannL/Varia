import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { sha256, stableStringify } from '@varia/probe-runtime'
import { parse as parseYaml, parseDocument, stringify as toYaml } from 'yaml'
import { z } from 'zod'
import { configSchema, DEFAULT_HANDLED, STRATEGY_NAMES, type ParsedConfig } from './schema.js'

export const CONFIG_FILES = ['varia.yml', 'varia.yaml', 'varia.json'] as const

/** Erreur de configuration (CDC §27 : code de sortie 3). */
export class ConfigError extends Error {
  readonly issues: string[]
  constructor(message: string, issues: string[] = []) {
    super(message)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

export interface HandledRuleResolved {
  name?: string
  namePattern?: string
  code?: string
  status?: number
  message?: string
}

export interface ResolvedConfig {
  /** Avertissements de validation (clés inconnues ignorées, CDC §5.3, B-05) : « chemin : CODE ». */
  warnings: string[]
  file: string | null
  root: string
  projectName: string
  parsed: ParsedConfig
  hash: string
  perInput: number
  strategies: string[]
  stabilityRuns: number
  handledErrors: string[]
  handledRules: HandledRuleResolved[]
}

const MODES = {
  quick: { perInput: 3, strategies: ['type', 'null', 'empty'], stabilityRuns: 1 },
  normal: { perInput: 10, strategies: [...STRATEGY_NAMES], stabilityRuns: 2 },
  full: { perInput: 20, strategies: [...STRATEGY_NAMES], stabilityRuns: 2 },
} as const

/** Trouve le fichier de configuration du projet ; deux fichiers à la fois sont refusés. */
export function findConfigFile(root: string): string | null {
  const found = CONFIG_FILES.map((f) => join(root, f)).filter((p) => existsSync(p))
  if (found.length > 1)
    throw new ConfigError(
      `plusieurs fichiers de configuration : ${found.map((f) => basename(f)).join(', ')}`,
    )
  return found[0] ?? null
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map(
    (i) => `${i.path.length > 0 ? i.path.join('.') : '(racine)'} : ${i.message}`,
  )
}

/**
 * Clés inconnues (CDC §5.3, B-05) : un AVERTISSEMENT, pas une erreur. Elles sont retirées (copie) et
 * listées ; toute autre erreur (valeur invalide) reste une erreur (exit 3).
 */
export function withoutUnknownKeys(raw: unknown): { raw: unknown; warnings: string[] } {
  const warnings: string[] = []
  const current: unknown = structuredClone(raw)
  for (;;) {
    const result = configSchema.safeParse(current)
    const unknown = result.success
      ? []
      : result.error.issues.filter((i) => i.code === 'unrecognized_keys')
    if (unknown.length === 0) return { raw: current, warnings }
    for (const issue of unknown) {
      const parent = issue.path.reduce<unknown>(
        (o, k) => (o as Record<PropertyKey, unknown>)[k],
        current,
      ) as Record<string, unknown>
      for (const key of issue.keys) {
        Reflect.deleteProperty(parent, key)
        warnings.push(`${[...issue.path, key].join('.')} : UNKNOWN_KEY`)
      }
    }
  }
}

/** Valide un objet de configuration et le résout (modes, valeurs par défaut, empreinte). */
export function resolveConfig(
  input: unknown,
  root: string,
  file: string | null,
  overrides: { mode?: 'quick' | 'normal' | 'full' } = {},
): ResolvedConfig {
  const { raw, warnings } = withoutUnknownKeys(input)
  const result = configSchema.safeParse(raw)
  if (!result.success) throw new ConfigError('configuration invalide', formatIssues(result.error))
  const parsed = result.data
  if (overrides.mode !== undefined) parsed.mutations.mode = overrides.mode
  const mode = MODES[parsed.mutations.mode]
  const rules = parsed.oracle.handled_errors
  const nameOnly = rules
    .filter((r) => r.name !== undefined && Object.keys(r).length === 1)
    .map((r) => r.name as string)
  const handledRules = rules
    .filter((r) => !(r.name !== undefined && Object.keys(r).length === 1))
    .map((r) => ({
      ...(r.name !== undefined ? { name: r.name } : {}),
      ...(r.name_pattern !== undefined ? { namePattern: r.name_pattern } : {}),
      ...(r.code !== undefined ? { code: r.code } : {}),
      ...(r.status !== undefined ? { status: r.status } : {}),
      ...(r.message !== undefined ? { message: r.message } : {}),
    }))
  const absRoot = resolve(root, parsed.project.path ?? '.')
  return {
    warnings: warnings.sort(),
    file,
    root: absRoot,
    projectName: parsed.project.name ?? basename(absRoot),
    parsed,
    hash: sha256(stableStringify(parsed)),
    perInput: parsed.mutations.per_input ?? mode.perInput,
    strategies: parsed.mutations.strategies ?? [...mode.strategies],
    stabilityRuns: parsed.baseline.stability_runs ?? mode.stabilityRuns,
    handledErrors: [...new Set([...DEFAULT_HANDLED, ...nameOnly])],
    handledRules,
  }
}

/**
 * Charge `varia.yml|yaml|json` du projet (absent : configuration par défaut). `overrides.file` désigne
 * un fichier de configuration HORS du projet (`varia --config`), pour ne pas modifier le projet cible.
 */
export function loadConfig(
  root: string,
  overrides: { mode?: 'quick' | 'normal' | 'full'; file?: string } = {},
): ResolvedConfig {
  if (overrides.file !== undefined && !existsSync(overrides.file)) {
    throw new ConfigError(`fichier de configuration introuvable : ${overrides.file}`)
  }
  const mode = overrides.mode !== undefined ? { mode: overrides.mode } : {}
  const file = overrides.file ?? findConfigFile(root)
  if (file === null) return resolveConfig({ version: 1 }, root, null, mode)
  const text = readFileSync(file, 'utf8')
  let raw: unknown
  try {
    raw = file.endsWith('.json') ? JSON.parse(text) : parseYaml(text)
  } catch (e) {
    throw new ConfigError(`${basename(file)} illisible : ${(e as Error).message}`)
  }
  return resolveConfig(raw, root, file, mode)
}

/** Configuration résolue affichable : valeurs d'environnement sensibles masquées (CDC §4.2). */
export function printableConfig(config: ResolvedConfig): string {
  const fields = config.parsed.redaction.fields.map((f) => f.toLowerCase())
  const env = Object.fromEntries(
    Object.entries(config.parsed.test.env).map(([k, v]) => [
      k,
      fields.some((f) => k.toLowerCase().includes(f)) ? '***' : v,
    ]),
  )
  return toYaml({ ...config.parsed, test: { ...config.parsed.test, env } })
}

/** JSON Schema publié pour l'autocomplétion (CDC §4.2). */
export function jsonSchema(): unknown {
  return z.toJSONSchema(configSchema, { io: 'input', target: 'draft-2020-12' })
}

/**
 * `varia oracle suggest` (CDC §18.7) : ajoute à `varia.yml` les noms d'erreurs classés par
 * l'utilisateur (HANDLED → `oracle.handled_errors`, CRASH → `oracle.crash_errors`), en conservant le
 * reste du document (commentaires compris). Ne fait qu'ÉDITER un texte ; l'écriture, après
 * confirmation, revient à l'appelant.
 */
export function applyOracleChoices(
  text: string,
  choices: { handled: string[]; crash: string[] },
): string {
  const doc = parseDocument(text.trim() === '' ? 'version: 1\n' : text)
  const handled = (
    doc.getIn(['oracle', 'handled_errors']) as { toJSON(): unknown } | undefined
  )?.toJSON() as { name?: string }[] | undefined
  const known = new Set((handled ?? []).map((h) => h.name))
  const added = choices.handled.filter((name) => !known.has(name)).map((name) => ({ name }))
  // `addIn` sur un chemin absent crée une table, pas une liste : la liste est réécrite entière.
  if (added.length > 0) doc.setIn(['oracle', 'handled_errors'], [...(handled ?? []), ...added])
  if (choices.crash.length > 0) {
    const current = (
      doc.getIn(['oracle', 'crash_errors']) as { toJSON(): unknown } | undefined
    )?.toJSON() as string[] | undefined
    const base = current ?? ['TypeError', 'ReferenceError', 'RangeError']
    doc.setIn(['oracle', 'crash_errors'], [...new Set([...base, ...choices.crash])])
  }
  return doc.toString()
}
