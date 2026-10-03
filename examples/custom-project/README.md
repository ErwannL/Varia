# examples/custom-project/

Projet d'exemple de l'adaptateur **custom** (X-01). `runner.cjs` est un lanceur de tests **factice**
qui n'importe rien de Varia : il implémente lui-même le protocole de sonde (norme 1.2 : enveloppe des
exports au chargement, sérialisation étiquetée, redaction, empreintes, mutation sur copie, profondeur
par `AsyncLocalStorage`, rejets non gérés) et le contrat custom (`VARIA_RESULTS`, `VARIA_TEST_FILE`,
`VARIA_TEST_NAME`, `VARIA_INCLUDE`/`VARIA_EXCLUDE`, `VARIA_DISCOVER`). Globaux de test : `describe`,
`it`, `test`, `test.each`, `expect` (sous-ensemble) ; fichiers `tests/**/*.test.js` (CommonJS).

Mêmes sources et tests que [`mocha-project`](../mocha-project/README.md) (comportements de référence du
§5 du jalon J4). `varia.yml` : `test.framework: custom`, capacités déclarées (observation, mutation
d'arguments, sélection par test, async, CJS, tests paramétrés, processus isolé), vérifiées par
`varia doctor`. Aucune dépendance (pas de `node_modules`). Scénarios : `tests/j4/custom*.test.ts`.
Dossiers `src/` et `tests/` : contenu lu comme données par Varia (pas de README, comme `jest-project`).
