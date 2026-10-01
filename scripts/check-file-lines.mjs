// Échoue si un fichier texte suivi dépasse 1000 lignes (règle qualité n°9).
import { readFileSync, existsSync } from 'node:fs'
import { trackedFiles } from './lib-files.mjs'

const MAX = 1000
const exempt = new Set(['package-lock.json', 'docs/SPEC.md'])
const textExt = /\.(?:[cm]?[jt]sx?|json|md|ya?ml|css|html|svg|txt)$/
const offenders = []
for (const file of trackedFiles()) {
  // Fichiers générés (lockfiles) et copie intégrale de la spécification : exemptés (docs/notes/fichiers-longs.md).
  if (
    exempt.has(file) ||
    file.endsWith('/package-lock.json') ||
    !textExt.test(file) ||
    !existsSync(file)
  )
    continue
  const n = readFileSync(file, 'utf8').split('\n').length
  if (n > MAX) offenders.push(`${file}: ${n} lignes`)
}
if (offenders.length > 0) {
  console.error(`Fichiers de plus de ${MAX} lignes :\n` + offenders.join('\n'))
  process.exit(1)
}
console.log('check:lines OK')
