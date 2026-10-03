// Liste, fichier par fichier, ce qui n'est pas couvert dans coverage/coverage-final.json (aide au
// travail de couverture ; ne juge rien, cf. check-coverage-exact.mjs).
// Usage : node scripts/coverage-gaps.mjs [filtre sur le chemin]
import { existsSync, readFileSync } from 'node:fs'
import { exactCounts } from './coverage-lib.mjs'

const filter = process.argv[2] ?? ''
if (!existsSync('coverage/coverage-final.json')) {
  // Les tests ont échoué avant d'écrire la couverture : rien à lister (diagnostic CI).
  console.log('coverage/coverage-final.json absent : aucune couverture écrite')
  process.exit(0)
}
const map = JSON.parse(readFileSync('coverage/coverage-final.json', 'utf8'))
for (const [file, fc] of Object.entries(map)) {
  if (!file.includes(filter)) continue
  const c = exactCounts(fc)
  const gaps = []
  for (const [k, n] of Object.entries(fc.s))
    if (n === 0) gaps.push(`  instruction l.${fc.statementMap[k].start.line}`)
  for (const [k, xs] of Object.entries(fc.b))
    xs.forEach((n, i) => {
      if (n === 0)
        gaps.push(`  branche l.${fc.branchMap[k].loc.start.line} [${i}] ${fc.branchMap[k].type}`)
    })
  for (const [k, n] of Object.entries(fc.f))
    if (n === 0) gaps.push(`  fonction ${fc.fnMap[k].name} l.${fc.fnMap[k].loc.start.line}`)
  if (gaps.length === 0) continue
  console.log(`${file} ${JSON.stringify(c)}`)
  console.log(gaps.join('\n'))
}
