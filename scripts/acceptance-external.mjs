// Acceptation J1-3 (CDC §45) sur le projet externe : baseline verte, plan, exécution plafonnée par budget
// avec échantillonnage annoncé, arbre du projet inchangé, rapport JSON valide contre son schéma.
// Prérequis : `node scripts/fetch-external.mjs` puis `npm run build`.
// Usage : node scripts/acceptance-external.mjs [nom-du-projet] [dossier-de-données]
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const name = process.argv[2] ?? 'immutability-helper'
const project = resolve('examples/external', name)
const config = resolve('examples/external-config', `${name}.varia.yml`)
const data = process.argv[3] ?? mkdtempSync(join(tmpdir(), 'varia-ext-'))
const status = () =>
  execFileSync('git', ['status', '--porcelain=v1', '--ignored'], { cwd: project, encoding: 'utf8' })
const before = status()
const t0 = Date.now()
const run = spawnSync(
  process.execPath,
  [resolve('bin/varia'), '--data-dir', data, '--config', config, 'test'],
  { cwd: project, encoding: 'utf8' },
)
const seconds = ((Date.now() - t0) / 1000).toFixed(1)
process.stderr.write(run.stderr)
process.stdout.write(run.stdout)
const reportFile = join(data, 'external-report.json')
execFileSync(
  process.execPath,
  [
    resolve('bin/varia'),
    '--data-dir',
    data,
    '--config',
    config,
    '-q',
    'report',
    '--out',
    reportFile,
  ],
  { cwd: project },
)
const report = JSON.parse(readFileSync(reportFile, 'utf8'))
const { reportSchema } = await import(resolve('packages/reporters/dist/index.js'))
const valid = reportSchema.safeParse(report).success
const after = status()
const summary = {
  exitCode: run.status,
  seconds,
  baseline: report.baseline,
  plan: report.plan,
  counts: report.counts,
  issues: report.issues.map((i) => `${i.severity} ${i.title} (${i.count})`),
  schemaValid: valid,
  projectUnchanged: before === after,
  report: reportFile,
}
console.log(JSON.stringify(summary, null, 2))
const ok =
  valid &&
  before === after &&
  report.baseline.failing.length === 0 &&
  report.plan !== null &&
  report.counts.pending === 0
process.exit(ok ? 0 : 1)
