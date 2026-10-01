# src/

- `adapter.ts` — interface `TestAdapter` et capacités (le cœur ne connaît aucun runner).
- `observe.ts` — appels observés, comparaison de baselines (stabilité).
- `catalog.ts`, `hints.ts` — catalogue d'inputs, bornes, formats, contrats déclarés.
- `strategies/` — stratégies de mutation. `plan.ts` — plan déterministe. `rng.ts` — mulberry32.
- `oracle.ts` — classification. `issues.ts` — regroupement, gravité. `metrics.ts` — comptes.
- `integrity.ts` — instantanés du projet cible. `paths.ts` — stockage utilisateur. `exec/` — processus.
