import type { InputDescriptor, MutationCandidate } from '@varia/core'
import type { Json } from '@varia/probe-protocol'
import { sha256, stableStringify } from '@varia/probe-runtime'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  PLUGIN_API_VERSION,
  RULE_STATUSES,
  type OracleRuleInput,
  type RuleStatus,
  type StrategyLimits,
} from './contracts.js'
import { PluginThread, type HostResponse } from './host.js'

/** Erreurs d'extension (origine `PLUGIN_FAILURE`, distincte de `PROJECT_FAILURE`, CDC §44). */
export type PluginFailureCode =
  | 'NOT_FOUND'
  | 'LOAD_ERROR'
  | 'API_VERSION_INCOMPATIBLE'
  | 'INVALID_SHAPE'
  | 'DUPLICATE_ID'
  | 'THROWN'
  | 'TIMEOUT'
  | 'NON_DETERMINISTIC'
  | 'MATH_RANDOM_FORBIDDEN'
  | 'LIMIT_EXCEEDED'

export type PluginPhase = 'load' | 'plan' | 'fuzz' | 'report'
export type ExtensionKind = 'strategy' | 'detector' | 'rule' | 'reporter'

export interface PluginFailure {
  origin: 'PLUGIN_FAILURE'
  /** Nom du plugin (ou son spécificateur s'il n'a pas pu être chargé). */
  plugin: string
  /** Identifiant complet `<plugin>/<id>` de l'extension ; `null` : le plugin entier. */
  extension: string | null
  phase: PluginPhase
  code: PluginFailureCode
  message: string
}

/** Longueur maximale de `VariaPlugin.version`. */
export const PLUGIN_VERSION_MAX = 64

/** Version déclarée valide : chaîne non vide (hors espaces) d'au plus 64 caractères. */
export const validVersion = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== '' && v.length <= PLUGIN_VERSION_MAX

export interface LoadedExtension {
  kind: ExtensionKind
  /** Identifiant complet `<plugin>/<id>`. */
  id: string
  /** Désactivée pour le run après une erreur (voir `failures`). */
  disabled: boolean
  /** Rapporteur : extension du fichier produit. */
  fileExtension?: string
}

export interface LoadedPlugin {
  name: string
  specifier: string
  apiVersion: number
  /** Version déclarée par l'extension (`VariaPlugin.version`), absente si non déclarée. */
  version?: string
  extensions: LoadedExtension[]
}

export interface PluginsSummary {
  loaded: LoadedPlugin[]
  failures: PluginFailure[]
}

/** Verdict d'une règle externe retenu (la première règle, dans l'ordre de chargement, qui a un avis). */
export interface AppliedVerdict {
  status: RuleStatus
  reason: string
  rule: string
}

export interface ReporterOutput {
  id: string
  extension: string
  content: string
}

export interface LoadOptions {
  /** Entrées de `plugins` dans l'ordre de la configuration. */
  specifiers: string[]
  /** Dossier de résolution des chemins relatifs (celui du fichier de configuration). */
  baseDir: string
  /** Racine du projet : les paquets sont résolus depuis ses `node_modules`. */
  root: string
  /** Délai d'un appel à une extension (ms) : au-delà, le plugin est arrêté. */
  timeoutMs: number
}

/** Plafond du nombre de valeurs proposées par une stratégie pour UNE entrée. */
export const MAX_CANDIDATES_PER_INPUT = 100
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const REASON = /^[A-Z0-9_]{1,64}$/
const FILE_EXT = /^[a-z0-9]{1,16}$/
const KIND_ORDER: ExtensionKind[] = ['strategy', 'detector', 'rule', 'reporter']
const MESSAGE_MAX = 500

/** Graine d'une génération : graine du run, call site, chemin et extension (indépendante de l'ordre). */
export function seedFor(seed: number, input: InputDescriptor, extension: string): number {
  return parseInt(
    sha256([String(seed), input.callSiteId, input.pathStr, extension].join('\u0000')).slice(0, 8),
    16,
  )
}

/**
 * Résout une entrée de `plugins` : chemin (commence par `.`, `/` ou absolu) relatif au fichier de
 * configuration, sinon paquet installé dans le projet. `null` : introuvable.
 */
export function resolvePlugin(spec: string, baseDir: string, root: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || isAbsolute(spec)) {
    const file = resolve(baseDir, spec)
    return existsSync(file) ? file : null
  }
  try {
    return createRequire(join(root, 'package.json')).resolve(spec)
  } catch {
    return null
  }
}

/**
 * Vérifie une valeur proposée : JSON pur (objets simples, nombres finis) et plafonds durs. Rend le
 * code d'erreur, ou `null` si la valeur est conforme.
 */
export function checkValue(
  v: unknown,
  limits: StrategyLimits,
  depth = 0,
): 'INVALID_SHAPE' | 'LIMIT_EXCEEDED' | null {
  if (depth > limits.objectDepth) return 'LIMIT_EXCEEDED'
  if (v === null || typeof v === 'boolean') return null
  if (typeof v === 'number') return Number.isFinite(v) ? null : 'INVALID_SHAPE'
  if (typeof v === 'string') return v.length > limits.stringLength ? 'LIMIT_EXCEEDED' : null
  if (Array.isArray(v)) {
    if (v.length > limits.arrayLength) return 'LIMIT_EXCEEDED'
    return firstError(v, limits, depth)
  }
  if (typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype) return 'INVALID_SHAPE'
  return firstError(Object.values(v), limits, depth)
}

function firstError(items: unknown[], limits: StrategyLimits, depth: number) {
  for (const x of items) {
    const e = checkValue(x, limits, depth + 1)
    if (e !== null) return e
  }
  return null
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** Candidats d'une stratégie pour une entrée, validés ; ou le code d'erreur. */
export function candidatesOf(
  raw: unknown,
  strategy: string,
  limits: StrategyLimits,
): MutationCandidate[] | PluginFailureCode {
  if (!Array.isArray(raw)) return 'INVALID_SHAPE'
  if (raw.length > MAX_CANDIDATES_PER_INPUT) return 'LIMIT_EXCEEDED'
  const out: MutationCandidate[] = []
  for (const c of raw) {
    if (!isRecord(c)) return 'INVALID_SHAPE'
    const op = c['op'] ?? 'set'
    if (op === 'delete') {
      out.push({ strategy, op: 'delete', value: null })
      continue
    }
    if (op !== 'set' || !('value' in c)) return 'INVALID_SHAPE'
    const error = checkValue(c['value'], limits)
    if (error !== null) return error
    out.push({ strategy, op: 'set', value: c['value'] as Json })
  }
  return out
}

interface Entry {
  plugin: LoadedPlugin
  thread: PluginThread
}

/** Extensions chargées pour une commande ; chaque erreur est consignée, jamais propagée. */
export class PluginSession {
  readonly loaded: LoadedPlugin[] = []
  readonly failures: PluginFailure[] = []
  private readonly entries: Entry[] = []

  constructor(private readonly o: LoadOptions) {
    for (const spec of o.specifiers) this.load(spec)
  }

  private fail(
    plugin: string,
    extension: string | null,
    phase: PluginPhase,
    code: PluginFailureCode,
    message: string,
  ): void {
    this.failures.push({
      origin: 'PLUGIN_FAILURE',
      plugin,
      extension,
      phase,
      code,
      message: message.slice(0, MESSAGE_MAX),
    })
  }

  private load(spec: string): void {
    const file = resolvePlugin(spec, this.o.baseDir, this.o.root)
    if (file === null) return this.fail(spec, null, 'load', 'NOT_FOUND', `introuvable : ${spec}`)
    const thread = new PluginThread(this.o.timeoutMs)
    const r = thread.request({ op: 'load', url: pathToFileURL(file).href })
    if (!r.ok) {
      thread.close()
      const code = r.code === 'THROWN' ? 'LOAD_ERROR' : (r.code as PluginFailureCode)
      return this.fail(spec, null, 'load', code, r.message)
    }
    const d = r.value as Record<string, unknown>
    const name = d['name']
    const refuse = (code: PluginFailureCode, message: string) => {
      thread.close()
      this.fail(typeof name === 'string' ? name : spec, null, 'load', code, message)
    }
    if (d['apiVersion'] !== PLUGIN_API_VERSION)
      return refuse(
        'API_VERSION_INCOMPATIBLE',
        `apiVersion ${JSON.stringify(d['apiVersion']) ?? 'absente'} ; cette version de Varia accepte ${String(PLUGIN_API_VERSION)}`,
      )
    if (typeof name !== 'string' || !NAME.test(name))
      return refuse('INVALID_SHAPE', `nom invalide : ${JSON.stringify(name) ?? 'absent'}`)
    if (this.loaded.some((p) => p.name === name))
      return refuse(
        'DUPLICATE_ID',
        `plugin « ${name} » déjà chargé (premier dans la configuration)`,
      )
    const version = d['version']
    if (version !== undefined && !validVersion(version))
      return refuse('INVALID_SHAPE', `version invalide : ${JSON.stringify(version)}`)
    const plugin: LoadedPlugin = {
      name,
      specifier: spec,
      apiVersion: 1,
      ...(version === undefined ? {} : { version }),
      extensions: [],
    }
    for (const kind of KIND_ORDER) {
      for (const x of d[kind] as Record<string, unknown>[]) {
        const id = x['id']
        const full = `${name}/${String(id)}`
        if (typeof id !== 'string' || !NAME.test(id))
          this.fail(name, full, 'load', 'INVALID_SHAPE', `identifiant invalide (${kind})`)
        else if (plugin.extensions.some((e) => e.id === full))
          this.fail(name, full, 'load', 'DUPLICATE_ID', `identifiant déjà déclaré (${kind})`)
        else if (kind === 'reporter' && !FILE_EXT.test(String(x['extension'])))
          this.fail(name, full, 'load', 'INVALID_SHAPE', 'extension de fichier invalide')
        else
          plugin.extensions.push({
            kind,
            id: full,
            disabled: false,
            ...(kind === 'reporter' ? { fileExtension: String(x['extension']) } : {}),
          })
      }
    }
    this.loaded.push(plugin)
    this.entries.push({ plugin, thread })
  }

  /** Extensions actives d'un type, dans l'ordre de chargement (ordre de la configuration). */
  private active(kinds: ExtensionKind[]): { entry: Entry; ext: LoadedExtension }[] {
    return this.entries.flatMap((entry) =>
      entry.plugin.extensions
        .filter((ext) => kinds.includes(ext.kind) && !ext.disabled)
        .map((ext) => ({ entry, ext })),
    )
  }

  /** Appelle une extension ; toute erreur la désactive (un délai dépassé : tout son plugin). */
  private call(
    entry: Entry,
    ext: LoadedExtension,
    phase: PluginPhase,
    msg: Record<string, unknown>,
  ): { ok: true; value: unknown } | { ok: false } {
    const r: HostResponse = entry.thread.request({
      ...msg,
      id: ext.id.slice(entry.plugin.name.length + 1),
    })
    if (r.mathRandom === true)
      return this.disable(entry, ext, phase, 'MATH_RANDOM_FORBIDDEN', 'Math.random appelé')
    if (!r.ok) return this.disable(entry, ext, phase, r.code as PluginFailureCode, r.message)
    return { ok: true, value: r.value }
  }

  private disable(
    entry: Entry,
    ext: LoadedExtension,
    phase: PluginPhase,
    code: PluginFailureCode,
    message: string,
  ): { ok: false } {
    for (const e of entry.plugin.extensions) if (e === ext || code === 'TIMEOUT') e.disabled = true
    this.fail(entry.plugin.name, ext.id, phase, code, message)
    return { ok: false }
  }

  /** Identifiants des stratégies externes actives (stratégies et détecteurs de format). */
  strategyIds(): string[] {
    return this.active(['strategy', 'detector']).map((a) => a.ext.id)
  }

  /**
   * Candidats externes par entrée (`callSiteId|pathStr`). Chaque stratégie est appelée DEUX fois avec
   * les mêmes graines : sorties différentes ⇒ `NON_DETERMINISTIC`. Une stratégie en erreur ne
   * contribue aucun candidat (tout ou rien : le plan reste déterministe).
   */
  generate(
    inputs: InputDescriptor[],
    seed: number,
    limits: StrategyLimits,
    only?: string[],
  ): Map<string, MutationCandidate[]> {
    const out = new Map<string, MutationCandidate[]>()
    for (const { entry, ext } of this.active(['strategy', 'detector'])) {
      if (only !== undefined && !only.includes(ext.id)) continue
      const isStrategy = ext.kind === 'strategy'
      const scope = isStrategy
        ? inputs
        : inputs.filter((i) => i.type === 'string' && typeof i.original === 'string')
      const msg = isStrategy
        ? {
            op: 'strategy',
            inputs: scope,
            seeds: scope.map((i) => seedFor(seed, i, ext.id)),
            limits,
          }
        : { op: 'detector', values: scope.map((i) => i.original) }
      const first = this.call(entry, ext, 'plan', msg)
      if (!first.ok) continue
      const second = this.call(entry, ext, 'plan', msg)
      if (!second.ok) continue
      if (stableStringify(first.value as Json) !== stableStringify(second.value as Json)) {
        this.disable(entry, ext, 'plan', 'NON_DETERMINISTIC', 'deux générations, même graine')
        continue
      }
      const perInput = this.validate(first.value, scope, ext.id, isStrategy, limits)
      if (typeof perInput === 'string') {
        this.disable(entry, ext, 'plan', perInput, 'valeur renvoyée non conforme au contrat')
        continue
      }
      for (const [key, list] of perInput) out.set(key, [...(out.get(key) ?? []), ...list])
    }
    return out
  }

  private validate(
    raw: unknown,
    scope: InputDescriptor[],
    id: string,
    isStrategy: boolean,
    limits: StrategyLimits,
  ): Map<string, MutationCandidate[]> | PluginFailureCode {
    const results = raw as unknown[]
    const out = new Map<string, MutationCandidate[]>()
    for (const [n, input] of scope.entries()) {
      const r = results[n]
      if (r === null) continue
      if (isRecord(r)) return 'INVALID_SHAPE'
      const list = isStrategy
        ? candidatesOf(r, id, limits)
        : Array.isArray(r) && r.every((v) => typeof v === 'string')
          ? candidatesOf(
              r.map((value) => ({ value })),
              id,
              limits,
            )
          : 'INVALID_SHAPE'
      if (typeof list === 'string') return list
      out.set(`${input.callSiteId}|${input.pathStr}`, list)
    }
    return out
  }

  /** Règles d'oracle externes : la première, dans l'ordre de chargement, qui rend un avis l'emporte. */
  applyRules(input: OracleRuleInput): AppliedVerdict | null {
    for (const { entry, ext } of this.active(['rule'])) {
      const r = this.call(entry, ext, 'fuzz', { op: 'rule', input })
      if (!r.ok || r.value === null || r.value === undefined) continue
      const v = r.value
      if (
        !isRecord(v) ||
        !(RULE_STATUSES as readonly unknown[]).includes(v['status']) ||
        typeof v['reason'] !== 'string' ||
        !REASON.test(v['reason'])
      ) {
        this.disable(entry, ext, 'fuzz', 'INVALID_SHAPE', 'verdict non conforme au contrat')
        continue
      }
      return { status: v['status'] as RuleStatus, reason: v['reason'], rule: ext.id }
    }
    return null
  }

  /** Rapporteurs externes : chacun reçoit le rapport JSON (déjà masqué) et rend un texte. */
  render(report: Readonly<Record<string, unknown>>): ReporterOutput[] {
    const out: ReporterOutput[] = []
    for (const { entry, ext } of this.active(['reporter'])) {
      const r = this.call(entry, ext, 'report', { op: 'reporter', report })
      if (!r.ok) continue
      if (typeof r.value !== 'string') {
        this.disable(entry, ext, 'report', 'INVALID_SHAPE', 'le rendu doit être une chaîne')
        continue
      }
      out.push({ id: ext.id, extension: ext.fileExtension as string, content: r.value })
    }
    return out
  }

  summary(): PluginsSummary {
    return structuredClone({ loaded: this.loaded, failures: this.failures })
  }

  close(): void {
    for (const e of this.entries) e.thread.close()
  }
}

/** Charge les extensions de la configuration (aucune ⇒ session vide, aucun thread). */
export function loadPlugins(o: LoadOptions): PluginSession {
  return new PluginSession(o)
}
