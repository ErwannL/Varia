# Couverture

- Seuils **par fichier** et par axe dans `vitest.config.ts` (`coverage.thresholds`), versionnés en J1 à
  partir des valeurs mesurées (arrondies à l'entier inférieur). **Jamais abaissés** : on ajoute des tests.
- `npm run check` lance `vitest run --coverage` : un fichier sous son seuil fait échouer la CI.
- Non mesurés par v8 dans le processus Vitest, car exécutés **ailleurs** (dans Jest ou en sous-processus) :
  `packages/probe-runtime/runtime/probe.cjs`, `packages/adapters/jest/runtime/transform.cjs`,
  `packages/core/runtime/supervisor.cjs`. Ils sont couverts par les tests d'intégration qui lancent
  Jest réellement (`tests/j1/*`, `packages/core/test/exec.test.ts`, `tests/runtime-compat.test.ts`).
  Mesurer leur couverture via `NODE_V8_COVERAGE` dans les sous-processus est une piste J3.
- Points d'entrée sans logique exclus : `packages/cli/src/main.ts`, `*/write-schema.ts`, `dashboard/src/main.tsx`.
