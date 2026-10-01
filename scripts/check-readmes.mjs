// Échoue si un dossier suivi n'a pas de README.md (règle qualité n°10).
// Exemptés : dossiers dont le contenu est lu comme des données (liste ci-dessous).
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { trackedFiles } from './lib-files.mjs'

const dataDirs = [
  /^examples\/[^/]+\/(?:src|tests|lib|esm-src)(?:\/|$)/,
  /^brand\/(?:png|previews)(?:\/|$)/,
  /^\.github(?:\/|$)/,
  /^reports\/assets(?:\/|$)/,
  /^docs\/assets(?:\/|$)/,
  /\/fixtures(?:\/|$)/,
  /^packages\/dashboard\/public(?:\/|$)/,
]
const dirs = new Set()
for (const file of trackedFiles()) {
  let d = dirname(file)
  while (d !== '.' && d !== '') {
    dirs.add(d)
    d = dirname(d)
  }
}
const missing = [...dirs]
  .filter((d) => !dataDirs.some((re) => re.test(d)))
  .filter((d) => !existsSync(`${d}/README.md`))
  .sort()
if (missing.length > 0) {
  console.error('Dossiers sans README.md :\n' + missing.join('\n'))
  process.exit(1)
}
console.log(`check:readmes OK (${dirs.size} dossiers)`)
