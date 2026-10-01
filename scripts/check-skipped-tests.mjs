// Échoue si un test de Varia est sauté, isolé ou laissé « à faire » (règle qualité n°1).
import { readFileSync, existsSync } from 'node:fs'
import { trackedFiles } from './lib-files.mjs'

const pattern =
  /\b(?:it|test|describe|suite)\s*\.\s*(?:skip|only|todo|skipIf|runIf)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(/
const offenders = []
for (const file of trackedFiles()) {
  if (!/\.test\.[cm]?[jt]s$/.test(file) || file.startsWith('examples/') || !existsSync(file))
    continue
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (pattern.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`)
    })
}
if (offenders.length > 0) {
  console.error('Tests sautés/isolés interdits :\n' + offenders.join('\n'))
  process.exit(1)
}
console.log('check:skips OK (aucun test sauté)')
