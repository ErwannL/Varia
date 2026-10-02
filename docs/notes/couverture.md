# Couverture

## Politique (J3)

- Cible : **100 %** des instructions, branches, fonctions et lignes, **fichier par fichier**. Les seuils
  sont versionnés dans un fichier unique et ne sont **jamais** abaissés.
- Les portes jugent `couverts / total` lus dans le JSON de couverture, jamais le pourcentage arrondi.
- Interdits : commentaires `v8 ignore` / `c8 ignore` / `istanbul ignore`, exclusions ajoutées pour
  esquiver, contact avec `global.__coverage__`, exécution factice pour allumer des lignes.
- Branche inatteignable = code mort : on la supprime (justification d'une ligne dans le commit).
- Branches de plateforme : la plateforme est injectée en paramètre, les deux branches sont testées.
- Supprimer le dossier `coverage/` avant chaque mesure (un dossier partiel fausse le total).

## Mesure de base J3 (avant correction)

Commande : `rm -rf coverage && npm run build && npx vitest run --coverage --maxWorkers=2
--coverage.reporter=json-summary` (2026-10-02, Linux x64, Node 22). 40 fichiers de test, 347 tests,
tous verts. Total : instructions 7001/7235, branches 2008/2292, fonctions 350/368.

Fichiers mesurés sous 100 %, classés par déficit (éléments non couverts : instructions / branches /
fonctions / lignes, puis somme) :

| Fichier                                        | Non couverts (I / B / F / L) | Somme |
| ---------------------------------------------- | ---------------------------- | ----- |
| `packages/cli/src/program.ts`                  | 49 / 35 / 1 / 49             | 134   |
| `packages/probe-runtime/runtime/serialize.cjs` | 40 / 33 / 3 / 40             | 116   |
| `packages/dashboard/src/components/Common.tsx` | 25 / 4 / 2 / 25              | 56    |
| `packages/dashboard/src/pages/Mutations.tsx`   | 21 / 9 / 1 / 21              | 52    |
| `packages/engine/src/baseline.ts`              | 20 / 9 / 1 / 20              | 50    |
| `packages/adapters/vitest/src/adapter.ts`      | 13 / 13 / 0 / 13             | 39    |
| `packages/engine/src/fuzz.ts`                  | 3 / 31 / 0 / 3               | 37    |
| `packages/api/src/server.ts`                   | 10 / 14 / 1 / 10             | 35    |
| `packages/adapters/jest/src/config.ts`         | 8 / 5 / 0 / 8                | 21    |
| `packages/dashboard/src/i18n.tsx`              | 8 / 3 / 1 / 8                | 20    |
| `packages/engine/src/context.ts`               | 5 / 8 / 1 / 5                | 19    |
| `packages/adapters/jest/src/adapter.ts`        | 3 / 12 / 0 / 3               | 18    |
| `packages/dashboard/src/pages/Compare.tsx`     | 6 / 4 / 1 / 6                | 17    |
| `packages/reporters/src/build.ts`              | 0 / 15 / 0 / 0               | 15    |
| `packages/core/src/oracle.ts`                  | 2 / 10 / 0 / 2               | 14    |
| `packages/engine/src/planning.ts`              | 3 / 8 / 0 / 3                | 14    |
| `packages/core/src/catalog.ts`                 | 2 / 6 / 0 / 2                | 10    |
| `packages/engine/src/doctor.ts`                | 4 / 2 / 0 / 4                | 10    |
| `packages/dashboard/src/components/Brand.tsx`  | 1 / 3 / 4 / 1                | 9     |
| `packages/dashboard/src/pages/Issues.tsx`      | 1 / 7 / 0 / 1                | 9     |
| `packages/dashboard/src/pages/Overview.tsx`    | 2 / 4 / 0 / 2                | 8     |
| `packages/core/src/observe.ts`                 | 0 / 7 / 0 / 0                | 7     |
| `packages/engine/src/replay.ts`                | 2 / 3 / 0 / 2                | 7     |
| `packages/core/src/issues.ts`                  | 0 / 5 / 0 / 0                | 5     |
| `packages/core/src/strategies/index.ts`        | 0 / 5 / 0 / 0                | 5     |
| `packages/dashboard/src/router.ts`             | 2 / 1 / 0 / 2                | 5     |
| `packages/reporters/src/formats.ts`            | 0 / 5 / 0 / 0                | 5     |
| `packages/core/src/exec/proc.ts`               | 2 / 0 / 0 / 2                | 4     |
| `packages/dashboard/src/pages/Runs.tsx`        | 1 / 2 / 0 / 1                | 4     |
| `packages/database/src/store.ts`               | 0 / 4 / 0 / 0                | 4     |
| `packages/core/src/plan.ts`                    | 0 / 3 / 0 / 0                | 3     |
| `packages/dashboard/src/App.tsx`               | 0 / 3 / 0 / 0                | 3     |
| `packages/dashboard/src/pages/NotCovered.tsx`  | 1 / 1 / 0 / 1                | 3     |
| `packages/reporters/src/policy.ts`             | 0 / 3 / 0 / 0                | 3     |
| `packages/cli/src/io.ts`                       | 0 / 0 / 2 / 0                | 2     |
| `packages/dashboard/src/pages/Acceptances.tsx` | 0 / 2 / 0 / 0                | 2     |
| `packages/core/src/integrity.ts`               | 0 / 1 / 0 / 0                | 1     |
| `packages/dashboard/src/api.ts`                | 0 / 1 / 0 / 0                | 1     |
| `packages/dashboard/src/pages/Tests.tsx`       | 0 / 1 / 0 / 0                | 1     |
| `packages/engine/src/incremental.ts`           | 0 / 1 / 0 / 0                | 1     |
| `packages/engine/src/integrity.ts`             | 0 / 1 / 0 / 0                | 1     |

Fichiers **non mesurés** à la mesure de base (exécutés hors du processus Vitest, ou exclus comme
points d'entrée) : `packages/probe-runtime/runtime/probe.cjs`, `packages/adapters/jest/runtime/transform.cjs`,
`packages/core/runtime/supervisor.cjs`, `packages/adapters/vitest/runtime/{plugin,rewrite,run-vitest}.mjs`,
`packages/cli/src/main.ts`, `packages/*/src/write-schema.ts`, `packages/dashboard/src/main.tsx`.
Ils entrent dans le périmètre mesuré en J3 (voir plus bas, au fil des commits).

Remarque : sans `npm run build` préalable, `tests/j1/acceptance.test.ts` (J1-5) échoue (il lance
`packages/cli/dist/main.js`) et aucun rapport n'est écrit.
