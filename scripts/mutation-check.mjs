// Preuve que les tests peuvent échouer (règle qualité n°2, acceptation J1-6) : applique une à une des
// mutations manuelles du code de Varia, lance les tests concernés, exige au moins un échec, restaure.
// Usage : node scripts/mutation-check.mjs <fichier-de-cas.json> [filtre sur le nom des cas]
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const filter = process.argv[3]
const cases = JSON.parse(
  readFileSync(process.argv[2] ?? 'scripts/mutation-cases.json', 'utf8'),
).filter((c) => filter === undefined || c.name.includes(filter))
let ok = true
for (const c of cases) {
  const original = readFileSync(c.file, 'utf8')
  if (!original.includes(c.find)) {
    console.error(`✗ ${c.name} : motif introuvable dans ${c.file}`)
    ok = false
    continue
  }
  writeFileSync(c.file, original.replace(c.find, c.replace))
  try {
    const r = spawnSync('npx', ['vitest', 'run', ...c.tests], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })
    const out = r.stdout + r.stderr
    const failed = /Tests\s+(\d+) failed/.exec(out)?.[1]
    if (r.status !== 0 && failed !== undefined)
      console.log(`✓ ${c.name} : ${failed} test(s) en échec`)
    else {
      console.error(`✗ ${c.name} : aucun test n'a échoué (code ${r.status})`)
      ok = false
    }
  } finally {
    writeFileSync(c.file, original)
  }
}
process.exit(ok ? 0 : 1)
