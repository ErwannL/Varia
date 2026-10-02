// Monte les seuils de coverage-thresholds.json au niveau mesuré (coverage/coverage-exact.json), sans
// jamais en abaisser un ; une entrée de fichier qui atteint 100 % sur les quatre axes est retirée (la
// règle finale `packages/**` à 100 s'applique). Usage : node scripts/coverage-ratchet.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { AXES } from './coverage-lib.mjs'

const path = 'coverage-thresholds.json'
const cfg = JSON.parse(readFileSync(path, 'utf8'))
const exact = JSON.parse(readFileSync('coverage/coverage-exact.json', 'utf8'))
const kept = []
for (const t of cfg.thresholds) {
  const c = exact[t.pattern]
  if (t.pattern.includes('*') || c === undefined) {
    kept.push(t)
    continue
  }
  const next = { ...t }
  for (const a of AXES) {
    const [covered, total] = c[a]
    const measured = total === 0 ? 100 : Math.floor((covered * 100) / total)
    next[a] = Math.max(t[a], measured)
  }
  if (AXES.every((a) => next[a] === 100)) console.log(`100 % : ${t.pattern}`)
  else kept.push(next)
}
cfg.thresholds = kept
writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n')
