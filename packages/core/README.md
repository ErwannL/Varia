# @varia/core

Cœur indépendant de tout runner (CDC §6) : catalogue, stratégies, plan, oracle, issues, métriques,
intégrité, exécution supervisée. Aucun import de `jest`/`vitest` (vérifié par `tests/architecture.test.ts`).

- `src/` — code. `runtime/supervisor.cjs` — superviseur de processus (timeout appliqué même si
  l'orchestrateur meurt). `test/` — tests unitaires.
