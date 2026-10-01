import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export type JestConfig = Record<string, unknown>

/** Lit la configuration Jest du projet (package.json `jest`, ou jest.config.{js,cjs,json}). */
export async function loadProjectJestConfig(root: string): Promise<JestConfig> {
  for (const name of ['jest.config.json']) {
    const p = join(root, name)
    if (existsSync(p)) return applyPreset(root, JSON.parse(readFileSync(p, 'utf8')) as JestConfig)
  }
  for (const name of ['jest.config.js', 'jest.config.cjs', 'jest.config.mjs']) {
    const p = join(root, name)
    if (existsSync(p)) {
      const mod = (await import(pathToFileURL(p).href)) as { default?: unknown }
      const value =
        typeof mod.default === 'function' ? await (mod.default as () => unknown)() : mod.default
      return applyPreset(root, (value ?? {}) as JestConfig)
    }
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { jest?: JestConfig }
  return applyPreset(root, pkg.jest ?? {})
}

/**
 * Fusionne le `preset` éventuel (ex. ts-jest) : sinon le transform du preset serait masqué par celui
 * que Varia génère. Le projet garde la priorité sur le preset.
 */
export function applyPreset(root: string, config: JestConfig): JestConfig {
  const preset = config['preset']
  if (typeof preset !== 'string') return config
  const req = createRequire(join(root, 'package.json'))
  const base = preset.replace('<rootDir>', root)
  let file: string | null = null
  for (const candidate of [
    `${base}/jest-preset.json`,
    `${base}/jest-preset.js`,
    `${base}/jest-preset.cjs`,
    base,
  ]) {
    try {
      file = req.resolve(candidate)
      break
    } catch {
      file = null
    }
  }
  if (file === null) throw new Error(`preset Jest introuvable : ${preset}`)
  const presetConfig = req(file) as JestConfig
  const { preset: _ignored, ...rest } = config
  void _ignored
  return {
    ...presetConfig,
    ...rest,
    transform: {
      ...(presetConfig['transform'] as object | undefined),
      ...(rest['transform'] as object | undefined),
    },
  }
}

/** Binaire Jest du projet. */
export function resolveJestBin(root: string): string {
  const req = createRequire(join(root, 'package.json'))
  return join(dirname(req.resolve('jest/package.json')), 'bin', 'jest.js')
}

function resolveTransformer(root: string, name: string): string {
  const spec = name.replace('<rootDir>', root)
  const req = createRequire(join(root, 'package.json'))
  try {
    return req.resolve(spec)
  } catch {
    const jestConfig = req.resolve('jest-config')
    return createRequire(jestConfig).resolve(spec)
  }
}

export interface GenerateOptions {
  root: string
  project: JestConfig
  transformPath: string
  probePath: string
  include: string[]
  exclude: string[]
  cacheDirectory: string
  salt: string
}

/**
 * Configuration Jest générée HORS du projet (CDC §5-2) : transform d'origine enveloppé par le
 * transform Varia (D1), sonde ajoutée à `setupFilesAfterEnv`, cache de transformation propre au run (§33.3).
 */
export function generateJestConfig(o: GenerateOptions): JestConfig {
  const original = (o.project['transform'] ?? { '\\.[jt]sx?$': 'babel-jest' }) as Record<
    string,
    string | [string, unknown]
  >
  const transform: Record<string, [string, unknown]> = {}
  for (const [pattern, entry] of Object.entries(original)) {
    const [name, cfg] = Array.isArray(entry) ? entry : [entry, {}]
    transform[pattern] = [
      o.transformPath,
      {
        original: resolveTransformer(o.root, name),
        originalConfig: cfg ?? {},
        include: o.include,
        exclude: o.exclude,
        projectRoot: o.root,
        salt: o.salt,
      },
    ]
  }
  const setup = (o.project['setupFilesAfterEnv'] as string[] | undefined) ?? []
  return {
    ...o.project,
    rootDir: resolve(o.root, (o.project['rootDir'] as string | undefined) ?? '.'),
    transform,
    setupFilesAfterEnv: [...setup, o.probePath],
    cacheDirectory: o.cacheDirectory,
    watchman: false,
    collectCoverage: false,
  }
}
