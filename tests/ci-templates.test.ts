// D-03 (CDC §28) : gabarits CI de docs/ci/. Structure analysée, et la ligne `varia` de chaque gabarit
// est EXÉCUTÉE par le vrai CLI (adapter scripté) : options inconnues ou rapports absents ⇒ échec.
import { runCli } from '@varia/cli'
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { scripted } from '../packages/engine/test/fake.js'

const dir = join(import.meta.dirname, '..', 'docs', 'ci')
const read = (f: string) => readFileSync(join(dir, f), 'utf8')

/** Ligne de commande `npx varia …` d'un gabarit, découpée en arguments. */
function variaLine(text: string): string[] {
  const line = /npx varia ([^'\n]+)/.exec(text)?.[1]
  if (line === undefined) throw new Error('aucune commande varia')
  return line.trim().split(/\s+/)
}

const TEMPLATES = {
  'github-actions.yml': (y: Record<string, unknown>) => {
    const steps = (y['jobs'] as { varia: { steps: Record<string, unknown>[] } }).varia.steps
    const uses = steps.map((s) => String(s['uses'] ?? ''))
    expect(uses.some((u) => u.startsWith('actions/cache@'))).toBe(true)
    expect(uses.some((u) => u.startsWith('github/codeql-action/upload-sarif@'))).toBe(true)
    const cache = steps.find((s) => String(s['uses']).startsWith('actions/cache@'))
    expect((cache?.['with'] as { path: string }).path).toBe('.varia-data')
    expect(steps.some((s) => s['run'] === 'npm ci')).toBe(true)
  },
  'gitlab-ci.yml': (y: Record<string, unknown>) => {
    const job = y['varia'] as {
      cache: { paths: string[] }
      script: string[]
      artifacts: { reports: { junit: string } }
    }
    expect(job.cache.paths).toEqual(['.varia-data/'])
    expect(job.script[0]).toBe('npm ci')
    expect(job.artifacts.reports.junit).toBe('varia-junit.xml')
  },
  'azure-pipelines.yml': (y: Record<string, unknown>) => {
    const steps = y['steps'] as Record<string, unknown>[]
    const tasks = steps.map((s) => String(s['task'] ?? ''))
    expect(tasks).toEqual(expect.arrayContaining(['Cache@2', 'PublishTestResults@2']))
    const cache = steps.find((s) => s['task'] === 'Cache@2')
    expect((cache?.['inputs'] as { path: string }).path).toBe('.varia-data')
  },
} as const

describe('gabarits CI (docs/ci)', () => {
  it.each(Object.keys(TEMPLATES))(
    '%s : YAML valide, cache du répertoire de données, rapports',
    (f) => {
      const text = read(f)
      TEMPLATES[f as keyof typeof TEMPLATES](parse(text) as Record<string, unknown>)
      expect(text).toContain('fail_on_new_only_against: main')
    },
  )
  it('Jenkinsfile : étapes install / varia, JUnit publié, rapports archivés', () => {
    const text = read('Jenkinsfile')
    expect(text).toMatch(/pipeline \{[\s\S]*stage\('Install'\)[\s\S]*sh 'npm ci'/)
    expect(text).toMatch(/stage\('Varia'\)/)
    expect(text).toContain("junit 'varia-junit.xml'")
    expect(text).toContain('archiveArtifacts')
    // Accolades équilibrées (analyse légère du Groovy).
    expect(text.split('{').length).toBe(text.split('}').length)
  })
  it.each([...Object.keys(TEMPLATES), 'Jenkinsfile'])(
    '%s : la commande varia s’exécute et produit JUnit, SARIF et Markdown',
    async (f) => {
      const args = variaLine(read(f))
      expect(args.slice(0, 3)).toEqual(['--data-dir', '.varia-data', 'ci'])
      const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'varia-citpl-')))
      writeFileSync(
        join(root, 'varia.yml'),
        "version: 1\nmutations: { seed: 1, per_input: 1, strategies: ['null'] }\nci: { fail_on_new_only_against: main }\n",
      )
      const adapter = scripted([{ name: 'a', calls: [{ export: 'f', args: [1] }] }])
      const out: string[] = []
      const code = await runCli(
        args,
        { out: (l) => out.push(l), err: () => undefined },
        {
          env: { LANG: 'fr_FR.UTF-8' },
          cwd: root,
          adapter: () => adapter,
        },
      )
      expect(code).toBe(0)
      for (const r of ['varia-junit.xml', 'varia.sarif', 'varia.md'])
        expect(existsSync(join(root, r))).toBe(true)
      expect(existsSync(join(root, '.varia-data'))).toBe(true)
    },
  )
})
