import { z } from 'zod'

/** Limites dures, non contournables par configuration (CDC §32-5). */
export const HARD_LIMITS = {
  totalMutations: 100_000,
  stringLength: 1_000_000,
  arrayLength: 100_000,
  objectDepth: 100,
  memoryMb: 16_384,
  timeoutMs: 600_000,
} as const

export const DEFAULT_REDACTION_FIELDS = [
  'password',
  'token',
  'apiKey',
  'authorization',
  'cookie',
  'secret',
  'privateKey',
]
export const DEFAULT_HANDLED = [
  'ValidationError',
  'ZodError',
  'ValidationException',
  'ValueError',
  'InvalidArgumentException',
  'IllegalArgumentException',
]
export const STRATEGY_NAMES = [
  'type',
  'null',
  'undefined',
  'empty',
  'boundary',
  'size',
  'structure',
  'format',
  'encoding',
] as const

const pair = z.tuple([z.number(), z.number()])

const handledRule = z
  .object({
    name: z.string().optional(),
    name_pattern: z.string().optional(),
    code: z.string().optional(),
    status: z.number().int().optional(),
    message: z.string().optional(),
  })
  .strict()

const acceptanceItem = z
  .object({
    mutation_pattern: z
      .object({
        function: z.string(),
        path: z.string().optional(),
        strategy: z.string().optional(),
      })
      .strict(),
    reason: z.string(),
    owner: z.string().optional(),
    expires: z.string().optional(),
  })
  .strict()

/** Schéma de `varia.yml` (CDC §4.2, annexes A et B). Clés inconnues refusées. */
export const configSchema = z
  .object({
    version: z.literal(1),
    project: z
      .object({ name: z.string().min(1).optional(), path: z.string().optional() })
      .strict()
      .default({}),
    test: z
      .object({
        command: z.string().optional(),
        framework: z.enum(['jest']).default('jest'),
        cwd: z.string().default('.'),
        env: z.record(z.string(), z.string()).default({}),
        node_options: z.string().optional(),
      })
      .strict()
      .default({ framework: 'jest', cwd: '.', env: {} }),
    baseline: z
      .object({ stability_runs: z.number().int().min(1).max(10).optional() })
      .strict()
      .default({}),
    targets: z
      .object({
        mode: z.enum(['declared', 'auto', 'hybrid']).default('auto'),
        include: z.array(z.string()).min(1).default(['src/**']),
        exclude: z.array(z.string()).default([]),
        depth: z.enum(['direct', 'all']).default('direct'),
        /** Targets `module#export` ou `export` (modes `declared` / `hybrid`). */
        declared: z.array(z.string()).default([]),
        remove: z.array(z.string()).default([]),
      })
      .strict()
      .default({
        mode: 'auto',
        include: ['src/**'],
        exclude: [],
        depth: 'direct',
        declared: [],
        remove: [],
      }),
    inputs: z
      .object({
        hints: z
          .array(
            z
              .object({
                path: z.string().regex(/^[^#]+#arg\d+/),
                range: pair.optional(),
                format: z.enum(['email', 'uuid', 'url', 'iso-date', 'ipv4']).optional(),
                length: pair.optional(),
              })
              .strict(),
          )
          .default([]),
        skip: z.array(z.string()).default([]),
        /** Valeurs déclarées par chemin (extension, DECISIONS D-006). */
        values: z.record(z.string(), z.array(z.unknown())).default({}),
      })
      .strict()
      .default({ hints: [], skip: [], values: {} }),
    mutations: z
      .object({
        mode: z.enum(['quick', 'normal', 'full']).default('normal'),
        per_input: z.number().int().min(1).max(100).optional(),
        strategies: z.array(z.enum(STRATEGY_NAMES)).min(1).optional(),
        seed: z.union([z.literal('auto'), z.number().int().min(0).max(0xffffffff)]).default('auto'),
        combine: z.literal(false).default(false),
        per_target: z.record(z.string(), z.number().int().min(0)).default({}),
        limits: z
          .object({
            total_mutations: z
              .number()
              .int()
              .min(1)
              .max(HARD_LIMITS.totalMutations)
              .default(10_000),
            string_length: z.number().int().min(1).max(HARD_LIMITS.stringLength).default(10_000),
            array_length: z.number().int().min(1).max(HARD_LIMITS.arrayLength).default(1_000),
            object_depth: z.number().int().min(1).max(HARD_LIMITS.objectDepth).default(20),
            memory_mb: z.number().int().min(64).max(HARD_LIMITS.memoryMb).default(512),
          })
          .strict()
          .default({
            total_mutations: 10_000,
            string_length: 10_000,
            array_length: 1_000,
            object_depth: 20,
            memory_mb: 512,
          }),
      })
      .strict()
      .default({
        mode: 'normal',
        seed: 'auto',
        combine: false,
        per_target: {},
        limits: {
          total_mutations: 10_000,
          string_length: 10_000,
          array_length: 1_000,
          object_depth: 20,
          memory_mb: 512,
        },
      }),
    execution: z
      .object({
        timeout_ms: z.number().int().min(100).max(HARD_LIMITS.timeoutMs).default(5000),
        parallelism: z.literal(1).default(1),
        isolation: z.literal('process').default('process'),
        warn_after_ms: z
          .number()
          .int()
          .min(0)
          .default(30 * 60_000),
        max_output_bytes: z
          .number()
          .int()
          .min(1024)
          .default(8 * 1024 * 1024),
        reset: z
          .object({
            environment: z.boolean().default(true),
            mocks: z.boolean().default(true),
            database: z.enum(['none']).default('none'),
            filesystem: z.enum(['none']).default('none'),
          })
          .strict()
          .default({ environment: true, mocks: true, database: 'none', filesystem: 'none' }),
      })
      .strict()
      .default({
        timeout_ms: 5000,
        parallelism: 1,
        isolation: 'process',
        warn_after_ms: 30 * 60_000,
        max_output_bytes: 8 * 1024 * 1024,
        reset: { environment: true, mocks: true, database: 'none', filesystem: 'none' },
      }),
    oracle: z
      .object({
        handled_errors: z.array(handledRule).default([]),
        crash_errors: z.array(z.string()).default(['TypeError', 'ReferenceError', 'RangeError']),
        suspicious_accept: z.enum(['report', 'ignore']).default('report'),
      })
      .strict()
      .default({
        handled_errors: [],
        crash_errors: ['TypeError', 'ReferenceError', 'RangeError'],
        suspicious_accept: 'report',
      }),
    redaction: z
      .object({
        fields: z.array(z.string()).default(DEFAULT_REDACTION_FIELDS),
        patterns: z.array(z.string()).default([]),
        store_raw_values: z.literal(false).default(false),
      })
      .strict()
      .default({ fields: DEFAULT_REDACTION_FIELDS, patterns: [], store_raw_values: false }),
    storage: z
      .object({
        path: z.string().optional(),
        location: z.enum(['user', 'project']).default('user'),
        retention_runs: z.number().int().min(1).default(50),
      })
      .strict()
      .default({ location: 'user', retention_runs: 50 }),
    integrity: z
      .object({
        watch_ignored: z.boolean().default(false),
        ignore_for_integrity: z.array(z.string()).default([]),
      })
      .strict()
      .default({ watch_ignored: false, ignore_for_integrity: [] }),
    cache: z
      .object({ enabled: z.literal(false).default(false) })
      .strict()
      .default({ enabled: false }),
    ci: z
      .object({
        fail_on: z
          .array(z.enum(['CRASH', 'TIMEOUT', 'UNEXPECTED_FAILURE', 'SUSPICIOUS_ACCEPT']))
          .default(['CRASH', 'TIMEOUT']),
        fail_on_regression: z.boolean().default(true),
        fail_on_new_only_against: z.string().optional(),
        include_transitive: z.boolean().default(false),
      })
      .strict()
      .default({
        fail_on: ['CRASH', 'TIMEOUT'],
        fail_on_regression: true,
        include_transitive: false,
      }),
    acceptances: z
      .union([
        z.array(acceptanceItem),
        z
          .object({
            store: z.enum(['file', 'db']).default('file'),
            items: z.array(acceptanceItem).default([]),
          })
          .strict(),
      ])
      .default([]),
  })
  .strict()

export type RawConfig = z.input<typeof configSchema>
export type ParsedConfig = z.output<typeof configSchema>
