// Préchargé (NODE_OPTIONS=--require) dans chaque processus Node lancé pendant la mesure de couverture.
// La couverture V8 de CE processus est déjà active (NODE_V8_COVERAGE est lue au démarrage) ; on évite
// qu'elle se propage à ses descendants (runners Jest/Vitest du projet cible, coûteux et hors périmètre),
// sauf pour le superviseur qui lance le lanceur Vitest de Varia (runtime/run-vitest.mjs).
'use strict'
const main = String(process.argv[1] ?? '').replace(/\\/g, '/')
const keep =
  main.endsWith('/packages/core/runtime/supervisor.cjs') &&
  process.argv.some((a) => a.replace(/\\/g, '/').endsWith('/runtime/run-vitest.mjs'))
if (!keep) delete process.env.NODE_V8_COVERAGE
