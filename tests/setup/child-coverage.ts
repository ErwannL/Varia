// Couverture des processus enfants (politique J3, docs/notes/couverture.md) : quand la mesure est
// demandée (`VARIA_CHILD_COVERAGE`, posée par scripts/coverage.mjs), chaque processus lancé par un
// test hérite de `NODE_V8_COVERAGE` et y dépose sa couverture V8 brute. Le processus de test lui-même
// n'est pas concerné (la variable est lue au démarrage d'un processus). Après chaque fichier de test,
// les dépôts sont réduits aux fichiers de Varia, pour borner le disque.
import { resolve } from 'node:path'
import { afterAll } from 'vitest'
import { pruneChildCoverage } from '../../scripts/coverage-lib.mjs'

const dir = process.env['VARIA_CHILD_COVERAGE']
if (dir !== undefined && dir !== '') {
  process.env['NODE_V8_COVERAGE'] = dir
  const preload = `--require ${JSON.stringify(resolve('tests/setup/coverage-preload.cjs'))}`
  process.env['NODE_OPTIONS'] = [process.env['NODE_OPTIONS'], preload].filter(Boolean).join(' ')
  afterAll(() => {
    pruneChildCoverage(dir, process.cwd())
  })
}
