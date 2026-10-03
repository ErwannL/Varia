<!-- Généré par `npm run capabilities` (scripts/write-capabilities.ts) — NE PAS ÉDITER. -->

# Capacités des adaptateurs (matrice mesurée)

Matrice **générée** en lançant le vrai `varia doctor` (moteur) sur le projet d’exemple de chaque
adaptateur : une baseline observée et une mutation réellement appliquée. Chaque cellule donne
« déclarée / vérifiée (raison) ». Statuts : `VERIFIED`, `NOT_VERIFIED`, `UNSUPPORTED`. Un adaptateur
dont l’outil est absent est marqué **non mesuré** : aucune valeur n’est alors affirmée.
`npm run capabilities:check` (et `tests/j4/capabilities.test.ts`) échoue si ce fichier diverge de la
mesure ou si un adaptateur n’a pas pu être mesuré.

## Adaptateurs

| Adaptateur | Projet d’exemple           | Lanceur (version) | Verdict | Constats                  |
| ---------- | -------------------------- | ----------------- | ------- | ------------------------- |
| jest       | `examples/jest-project`    | 29.7.0            | OK      | TRANSITIVE_CALLS_OBSERVED |
| vitest     | `examples/vitest-project`  | 3.2.7             | OK      | —                         |
| mocha      | `examples/mocha-project`   | 11.7.6            | OK      | TRANSITIVE_CALLS_OBSERVED |
| pytest     | `examples/pytest-project`  | 9.0.0             | OK      | TRANSITIVE_CALLS_OBSERVED |
| phpunit    | `examples/phpunit-project` | 11.5.2            | OK      | TRANSITIVE_CALLS_OBSERVED |
| junit      | `examples/junit-project`   | 5.11.4            | OK      | TRANSITIVE_CALLS_OBSERVED |
| custom     | `examples/custom-project`  | 1.0.0             | OK      | TRANSITIVE_CALLS_OBSERVED |

## Capacités (déclarée / vérifiée)

| Capacité         | jest                               | vitest                             | mocha                                    | pytest                             | phpunit                            | junit                              | custom                             |
| ---------------- | ---------------------------------- | ---------------------------------- | ---------------------------------------- | ---------------------------------- | ---------------------------------- | ---------------------------------- | ---------------------------------- |
| argumentMutation | oui / VERIFIED                     | oui / VERIFIED                     | oui / VERIFIED                           | oui / VERIFIED                     | oui / VERIFIED                     | oui / VERIFIED                     | oui / VERIFIED                     |
| asyncTargets     | oui / VERIFIED                     | oui / VERIFIED                     | oui / VERIFIED                           | oui / VERIFIED                     | non / UNSUPPORTED (NOT_DECLARED)   | oui / VERIFIED                     | oui / VERIFIED                     |
| cjs              | oui / VERIFIED                     | non / UNSUPPORTED (NOT_DECLARED)   | oui / VERIFIED                           | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   | oui / VERIFIED                     |
| coverage         | oui / VERIFIED                     | oui / VERIFIED                     | non / UNSUPPORTED (NOT_DECLARED)         | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   |
| esm              | non / UNSUPPORTED (NOT_DECLARED)   | oui / VERIFIED                     | oui / NOT_VERIFIED (OTHER_MODULE_SYSTEM) | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   |
| isolatedProcess  | oui / VERIFIED                     | oui / VERIFIED                     | oui / VERIFIED                           | oui / VERIFIED                     | oui / VERIFIED                     | oui / VERIFIED                     | oui / VERIFIED                     |
| mocks            | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)         | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   |
| observation      | oui / VERIFIED                     | oui / VERIFIED                     | oui / VERIFIED                           | oui / VERIFIED                     | oui / VERIFIED                     | oui / VERIFIED                     | oui / VERIFIED                     |
| parallelSafe     | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)         | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   | non / UNSUPPORTED (NOT_DECLARED)   |
| perTestSelection | oui / VERIFIED                     | oui / VERIFIED                     | oui / VERIFIED                           | oui / VERIFIED                     | oui / VERIFIED                     | oui / VERIFIED                     | oui / VERIFIED                     |
| testParameters   | oui / NOT_VERIFIED (NO_SMOKE_TEST) | oui / NOT_VERIFIED (NO_SMOKE_TEST) | oui / NOT_VERIFIED (NO_SMOKE_TEST)       | oui / NOT_VERIFIED (NO_SMOKE_TEST) | oui / NOT_VERIFIED (NO_SMOKE_TEST) | oui / NOT_VERIFIED (NO_SMOKE_TEST) | oui / NOT_VERIFIED (NO_SMOKE_TEST) |

## Raisons

| Code                  | Signification                          |
| --------------------- | -------------------------------------- |
| `NOT_DECLARED`        | Non déclarée par l’adapter             |
| `NO_SMOKE_TEST`       | Aucun test de fumée générique possible |
| `OTHER_MODULE_SYSTEM` | Autre système de modules que ce projet |
