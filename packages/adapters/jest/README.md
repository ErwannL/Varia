# @varia/adapter-jest

Adapter Jest (CDC §9, stratégie d'injection **D1** retenue en J0) : seul paquet autorisé à connaître
Jest (vérifié par `tests/architecture.test.ts`).

- `runtime/transform.cjs` — transform temporaire : délègue au transform du projet (babel-jest, ts-jest
  via `preset`…) puis ajoute `__varia.wrapExports` en fin des modules `targets.include`.
- `src/config.ts` — lecture de la config Jest du projet (`package.json`, `jest.config.*`, `preset`) et
  génération de la config éphémère **hors du projet** (cache de transformation propre au run).
- `src/adapter.ts` — `JestAdapter` (`detect`, `prepare`, `run`) : un processus Jest supervisé par
  exécution, sélection `--runTestsByPath` + `--testNamePattern`, sortie `--json` lue sur stdout.
- `test/` — tests.
