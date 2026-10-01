# @varia/reporters

Rapport JSON versionné d'un run (CDC §31) : `buildReport(reader, runId)` lit la base en lecture seule ;
`reportSchema` (Zod) le valide ; `schema/report.schema.json` est le JSON Schema publié (généré, vérifié
par un test). Les grandes valeurs sont résumées, jamais recopiées ; les limites sont toujours listées.

- `src/` — code. `schema/` — JSON Schema généré. `test/` — tests.
