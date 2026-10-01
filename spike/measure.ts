// Mesures obligatoires de J0 (CDC C.1) : démarrage Jest, surcoût de la sonde, durée d'une mutation.
// Usage : npx tsx spike/measure.ts  (écrit reports/j0-measures.json)
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Spike } from './src/spike.js'

const ROOT = resolve('examples/jest-project')
const REPS = 5
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
const dataDir = mkdtempSync(join(tmpdir(), 'varia-measure-'))

const plain = new Spike({ root: ROOT, dataDir, probe: false, timeoutMs: 30_000 })
const probed = new Spike({ root: ROOT, dataDir, timeoutMs: 3000 })

const startup: number[] = []
const basePlain: number[] = []
const baseProbe: number[] = []
for (let i = 0; i < REPS; i++) {
  startup.push(
    (
      await plain.session.runJest({
        mode: 'observe',
        testFile: 'tests/values.test.js',
        testName: 'exitOn ok',
      })
    ).process.durationMs,
  )
  basePlain.push((await plain.session.runJest({ mode: 'observe' })).process.durationMs)
  baseProbe.push((await probed.session.runJest({ mode: 'observe' })).process.durationMs)
}
const { observation } = await probed.baseline()
const plan = probed.plan(observation, {
  seed: 42,
  perInput: 20,
  skip: ['repeat#arg0'],
  perTarget: { 'src/values.js#repeat': 3 },
})
probed.savePlan(plan)
const sample = plan.mutations
  .filter((m) => m.export !== 'repeat' && m.export !== 'exitOn')
  .slice(0, 20)
const durations: number[] = []
for (const m of sample) durations.push((await probed.execute(plan, m)).run.process.durationMs)
const mean = durations.reduce((a, b) => a + b, 0) / durations.length
plain.dispose()
probed.dispose()

const result = {
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  repetitions: REPS,
  jest_startup_ms_median: Math.round(median(startup)),
  baseline_without_probe_ms_median: Math.round(median(basePlain)),
  baseline_with_probe_ms_median: Math.round(median(baseProbe)),
  probe_overhead_pct: Number(
    (((median(baseProbe) - median(basePlain)) / median(basePlain)) * 100).toFixed(1),
  ),
  mutation_sample_size: durations.length,
  mutation_mean_ms: Math.round(mean),
  estimate_1000_mutations_min: Number(((mean * 1000) / 60000).toFixed(1)),
  plan_size_example: plan.mutations.length,
}
writeFileSync('reports/j0-measures.json', JSON.stringify(result, null, 2) + '\n')
console.log(result)
