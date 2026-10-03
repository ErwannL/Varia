// Gabarit `varia scaffold adapter <nom>` (T-02) : paquet minimal implémentant TestAdapter, qui délègue
// au lanceur Vitest pour passer la suite de conformité dès sa création. Contenu fixe : aucune date,
// aucun chemin absolu (même entrée ⇒ mêmes octets). Fichiers conformes à Prettier une fois générés.
import { common, type Names } from './common.js'

const packageJson = (n: Names) => `{
  "name": "varia-adapter-${n.name}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@varia/adapter-vitest": "0.1.0",
    "@varia/core": "0.1.0"
  },
  "devDependencies": {
    "@types/node": "20.19.43",
    "@varia/adapter-conformance": "0.1.0",
    "typescript": "5.9.3",
    "vitest": "3.2.7"
  }
}
`

const index = (
  n: Names,
) => `// Adaptateur Varia « ${n.name} » : implémente le contrat TestAdapter de @varia/core.
// Squelette généré par \`varia scaffold adapter ${n.name}\` : chaque méthode délègue à un lanceur
// existant (Vitest), ce qui passe la suite de conformité dès la création. Remplacez la délégation,
// méthode par méthode, par le pilotage de votre lanceur (docs/writing-an-adapter.md de Varia).
import { VitestAdapter } from '@varia/adapter-vitest'
import type {
  AdapterCapabilities,
  AdapterRun,
  AdapterRunOptions,
  DetectResult,
  PrepareContext,
  TestAdapter,
} from '@varia/core'

export class ${n.pascal}Adapter implements TestAdapter {
  readonly id = '${n.name}'
  private readonly runner: TestAdapter

  constructor(runner: TestAdapter = new VitestAdapter()) {
    this.runner = runner
  }

  /** Le lanceur est-il installé dans le projet ? \`reasons\` explique un refus. */
  detect(root: string): Promise<DetectResult> {
    return this.runner.detect(root)
  }

  /** Capacités DÉCLARÉES ; \`varia doctor\` les vérifie sur le projet. */
  capabilities(): AdapterCapabilities {
    return this.runner.capabilities()
  }

  /** Configuration éphémère, hors du projet (dans \`ctx.tmpDir\`). */
  prepare(ctx: PrepareContext): Promise<void> {
    return this.runner.prepare(ctx)
  }

  /** Un processus supervisé : résultats des tests et événements JSONL de la sonde. */
  run(options: AdapterRunOptions): Promise<AdapterRun> {
    return this.runner.run(options)
  }
}
`

const unitTest = (
  n: Names,
) => `// Test unitaire : l'adaptateur expose son identifiant et délègue chaque méthode du contrat.
import type { AdapterCapabilities, AdapterRun, TestAdapter } from '@varia/core'
import { describe, expect, it } from 'vitest'
import { ${n.pascal}Adapter } from '../src/index.js'

const CAPABILITIES: AdapterCapabilities = {
  observation: true,
  argumentMutation: true,
  perTestSelection: true,
  asyncTargets: true,
  esm: true,
  cjs: false,
  mocks: false,
  testParameters: true,
  coverage: false,
  isolatedProcess: true,
  parallelSafe: false,
}

const RUN: AdapterRun = {
  process: {
    exitCode: 0,
    signal: null,
    timedOut: false,
    durationMs: 1,
    stdout: '',
    stderr: '',
    outputTruncated: false,
    pid: undefined,
  },
  tests: [],
  events: [],
  truncatedLines: 0,
  invalidLines: 0,
}

/** Lanceur factice : journalise les appels reçus. */
function fakeRunner(calls: string[]): TestAdapter {
  return {
    id: 'fake',
    detect: (root) => {
      calls.push('detect ' + root)
      return Promise.resolve({
        detected: true,
        framework: 'fake',
        version: '1.0.0',
        nativeEsm: false,
        reasons: [],
      })
    },
    capabilities: () => {
      calls.push('capabilities')
      return CAPABILITIES
    },
    prepare: (ctx) => {
      calls.push('prepare ' + ctx.runId)
      return Promise.resolve()
    },
    run: (options) => {
      calls.push('run ' + options.mode)
      return Promise.resolve(RUN)
    },
  }
}

describe('${n.pascal}Adapter', () => {
  it('a pour identifiant « ${n.name} »', () => {
    expect(new ${n.pascal}Adapter().id).toBe('${n.name}')
  })

  it('délègue detect, capabilities, prepare et run au lanceur', async () => {
    const calls: string[] = []
    const adapter = new ${n.pascal}Adapter(fakeRunner(calls))
    expect((await adapter.detect('/projet')).detected).toBe(true)
    expect(adapter.capabilities()).toEqual(CAPABILITIES)
    await adapter.prepare({
      root: '/projet',
      tmpDir: '/tmp/varia',
      runId: 'r_1',
      include: [],
      exclude: [],
      redact: { fields: [], patterns: [], skipPaths: [], hmacKey: 'k' },
    })
    expect(await adapter.run({ mode: 'observe', runDir: '/tmp/varia/run', timeoutMs: 1000 })).toBe(
      RUN,
    )
    expect(calls).toEqual(['detect /projet', 'capabilities', 'prepare r_1', 'run observe'])
  })
})
`

const conformanceTest = (
  n: Names,
) => `// Suite de conformité d'adaptateur de Varia (@varia/adapter-conformance), telle quelle, sur le
// projet d'exemple example/ (Vitest installé : npm install dans example/).
import { runConformance } from '@varia/adapter-conformance'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ${n.pascal}Adapter } from '../src/index.js'

const EXAMPLE = fileURLToPath(new URL('../example', import.meta.url))

describe('conformité de ${n.pascal}Adapter', () => {
  it('passe toutes les vérifications', async () => {
    const report = await runConformance({
      adapter: new ${n.pascal}Adapter(),
      example: EXAMPLE,
      dialect: { module: 'esm', ext: 'ts', testImport: "import { expect, test } from 'vitest'" },
    })
    expect(report.checks.filter((c) => c.status !== 'PASS')).toEqual([])
    expect(report.checks).toHaveLength(9)
  })
})
`

const vitestConfig = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 600_000, hookTimeout: 600_000 },
})
`

const examplePackage = (n: Names) => `{
  "name": "varia-adapter-${n.name}-example",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "3.2.7"
  }
}
`

const exampleConfig = `import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node' } })
`

const readme = (n: Names) => `# varia-adapter-${n.name}

Adaptateur Varia « ${n.name} » généré par \`varia scaffold adapter ${n.name}\`.

- \`src/index.ts\` — \`${n.pascal}Adapter\`, contrat \`TestAdapter\` (\`@varia/core\`). Le squelette
  délègue au lanceur Vitest : remplacez la délégation par le pilotage de votre lanceur.
- \`test/adapter.test.ts\` — test unitaire (délégation, identifiant).
- \`test/conformance.test.ts\` — suite de conformité d'adaptateur de Varia, telle quelle.
- \`example/\` — projet d'exemple de la conformité (seuls ses fichiers de premier niveau sont copiés).

\`\`\`bash
npm install && (cd example && npm install)
npm run typecheck
npm test
\`\`\`
`

/** Fichiers du squelette d'adaptateur (chemin relatif POSIX → contenu). */
export function adapterFiles(n: Names): Record<string, string> {
  return {
    ...common(),
    'README.md': readme(n),
    'package.json': packageJson(n),
    'vitest.config.ts': vitestConfig,
    'src/README.md': '# src/\n\nCode de l’adaptateur.\n',
    'src/index.ts': index(n),
    'test/README.md': '# test/\n\nTest unitaire et suite de conformité.\n',
    'test/adapter.test.ts': unitTest(n),
    'test/conformance.test.ts': conformanceTest(n),
    'example/README.md': '# example/\n\nProjet d’exemple de la suite de conformité (Vitest).\n',
    'example/package.json': examplePackage(n),
    'example/vitest.config.ts': exampleConfig,
  }
}
