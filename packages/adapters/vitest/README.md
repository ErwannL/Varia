# @varia/adapter-vitest

Adapter **Vitest** (J2). Seul endroit (avec `adapters/jest`) autorisé à connaître le runner.

- `runtime/rewrite.mjs` — réécriture des exports ESM (analyse TypeScript + `magic-string`, source maps).
- `runtime/plugin.mjs` — plugin Vite `enforce: pre` limité à `targets.include`.
- `runtime/run-vitest.mjs` — lanceur : API Node de la copie de Vitest **du projet** (`startVitest`),
  plugin, cache et setup injectés sans aucun fichier dans le projet.
- `src/adapter.ts` — `VitestAdapter` (`detect`, `prepare` écrit le setup qui importe la même instance
  de Vitest que les tests, `run`).
- `test/` — tests.
