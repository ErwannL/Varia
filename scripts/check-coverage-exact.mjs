// Porte de couverture EXACTE (politique J3) : lit coverage/coverage-exact.json (écrit par
// scripts/coverage.mjs) et coverage-thresholds.json ; échoue pour tout fichier sous son seuil sur un
// axe, tout fichier d'exécution requis non mesuré, tout fichier source ni mesuré ni exclu.
import { existsSync, readFileSync } from 'node:fs'
import { evaluateCoverage } from './coverage-lib.mjs'
import { trackedFiles } from './lib-files.mjs'

const exactPath = process.argv[2] ?? 'coverage/coverage-exact.json'
if (!existsSync(exactPath)) {
  console.error(`${exactPath} absent : lancer « npm run test:coverage » d'abord`)
  process.exit(1)
}
const exact = JSON.parse(readFileSync(exactPath, 'utf8'))
const cfg = JSON.parse(readFileSync(process.argv[3] ?? 'coverage-thresholds.json', 'utf8'))
const failures = evaluateCoverage(exact, cfg, trackedFiles())
if (failures.length > 0) {
  console.error(`check:coverage-exact : ${failures.length} échec(s)\n` + failures.join('\n'))
  process.exit(1)
}
console.log(`check:coverage-exact OK (${Object.keys(exact).length} fichiers mesurés)`)
