# @varia/api

API locale **en lecture seule** (CDC §25) servie par Fastify sur `127.0.0.1` (port 4321 par défaut) :
`/health` (expose `orqeaUrl` = `VARIA_ORQEA_URL`, nom et version), `/version`, et sous `/api/v1` :
`runs`, `runs/:id`, `runs/:id/summary`, `runs/:id/issues`, `runs/:id/mutations`, `runs/:id/not-covered`,
`reports/:id`, `issues/:id`, `issues/:id/history`, `mutations/:id`. Elle sert aussi le dashboard construit
(`packages/dashboard/dist`). Aucune route d'exécution ni d'ingestion : l'orchestrateur reste l'unique
écrivaine. En-têtes : CSP stricte (`frame-ancestors` limité à `'self'` et à l'origine Orqea), `nosniff`,
`no-referrer`. Les écritures d'acceptations (POST/DELETE) arrivent en J2.

- `src/` — serveur. `test/` — tests (requêtes injectées, sans réseau).
