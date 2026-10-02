// Mesure de couverture complète (politique J3, docs/notes/couverture.md) :
// 1. supprime toute mesure précédente (un dossier partiel fausserait le total) ;
// 2. lance Vitest avec couverture ; les processus enfants déposent leur couverture V8 brute ;
// 3. fusionne la couverture des enfants dans `coverage/coverage-final.json` ;
// 4. écrit `coverage/coverage-exact.json` (couverts / total par fichier et par axe).
// Usage : node scripts/coverage.mjs [arguments passés à vitest]
//         node scripts/coverage.mjs --merge-only   (refait 3-4 sur une mesure déjà faite)
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { AXES, exactCounts, mergeChildren } from './coverage-lib.mjs'

const root = process.cwd()
const out = join(root, 'coverage')
const children = join(root, '.coverage-children')
if (process.argv[2] !== '--merge-only') {
  rmSync(out, { recursive: true, force: true })
  rmSync(children, { recursive: true, force: true })
  const r = spawnSync(
    'npx',
    ['vitest', 'run', '--coverage', '--maxWorkers=2', ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, VARIA_CHILD_COVERAGE: children },
    },
  )
  if (r.status !== 0) process.exit(r.status ?? 1)
}
const finalPath = join(out, 'coverage-final.json')
const map = JSON.parse(readFileSync(finalPath, 'utf8'))
const merged = await mergeChildren(map, children, root)
writeFileSync(finalPath, JSON.stringify(map))
const exact = {}
const total = Object.fromEntries(AXES.map((a) => [a, [0, 0]]))
for (const [file, fc] of Object.entries(map)) {
  const c = exactCounts(fc)
  exact[relative(root, file).split('\\').join('/')] = c
  for (const a of AXES) {
    total[a][0] += c[a][0]
    total[a][1] += c[a][1]
  }
}
writeFileSync(join(out, 'coverage-exact.json'), JSON.stringify(exact, null, 1) + '\n')
rmSync(children, { recursive: true, force: true })
console.log(`couverture des processus enfants fusionnée : ${merged.length} fichier(s)`)
for (const a of AXES) console.log(`${a.padEnd(10)} : ${total[a][0]} / ${total[a][1]}`)
