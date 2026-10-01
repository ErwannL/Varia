# spike/ — J0 (supprimé à la fin de J1)

Spike d'injection de la sonde dans Jest (CDC partie C/D). Stratégie retenue : **D1 — transform
temporaire**. Voir `reports/j0.md`.

- `runtime/` — code chargé **dans** le processus Jest (CommonJS vérifié par `tsc --checkJs`) :
  sonde, transform, sérialisation partagée.
- `src/` — orchestrateur (TypeScript) : session, lancement Jest, observation, catalogue, plan, oracle,
  intégrité.
- `test/` — scénarios d'acceptation J0-1 à J0-20 et tests unitaires.
- `measure.ts` — mesures obligatoires (`npx tsx spike/measure.ts` → `reports/j0-measures.json`).
- `mutation-cases.json` — cas de `scripts/mutation-check.mjs` (preuve que les tests peuvent échouer).
