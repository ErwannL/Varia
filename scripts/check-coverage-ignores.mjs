// Échoue si un fichier suivi contient un moyen d'esquiver la mesure de couverture (politique J3,
// docs/notes/couverture.md) : commentaires d'exclusion v8/c8/istanbul, contact avec le compteur
// global d'istanbul. Les fichiers Markdown (documentation de la règle) ne sont pas analysés.
import { existsSync, readFileSync } from 'node:fs'
import { trackedFiles } from './lib-files.mjs'

const patterns = [
  /\b(?:v8|c8|istanbul)\s+ignore\b/i,
  /\b(?:v8|c8|istanbul)-ignore\b/i,
  /__coverage__/,
  /\/\*\s*node:coverage\s+(?:ignore|disable)/i,
]
const self = 'scripts/check-coverage-ignores.mjs'
const offenders = []
for (const file of trackedFiles()) {
  if (file === self || file.endsWith('.md') || file.startsWith('examples/') || !existsSync(file))
    continue
  if (!/\.(?:[cm]?[jt]sx?|json|ya?ml)$/.test(file)) continue
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (patterns.some((p) => p.test(line))) offenders.push(`${file}:${i + 1}: ${line.trim()}`)
    })
}
if (offenders.length > 0) {
  console.error('Esquive de couverture interdite :\n' + offenders.join('\n'))
  process.exit(1)
}
console.log('check:coverage-ignores OK')
