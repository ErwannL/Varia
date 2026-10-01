# @varia/config

Configuration du projet cible (`varia.yml`, `varia.yaml` ou `varia.json`, un seul) : schéma Zod
strict (clés inconnues refusées), limites dures (§32-5), modes `quick/normal/full` (§15), empreinte
de configuration, affichage masqué (`varia config --print`). `schema/varia.schema.json` est le JSON
Schema publié (régénéré par `npm run schema -w @varia/config`, vérifié par un test).

- `src/` — code. `schema/` — JSON Schema généré. `test/` — tests.
