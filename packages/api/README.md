# @varia/api

API locale **en lecture seule** (CDC §25) servie par Fastify sur `127.0.0.1` (port 4321 par défaut) :
`/health` (expose `orqeaUrl` = `VARIA_ORQEA_URL`, nom et version), `/version`, et sous `/api/v1` :
`runs`, `runs/:id`, `runs/:id/summary`, `runs/:id/issues`, `runs/:id/mutations`, `runs/:id/not-covered`,
`runs/:id/diff`, `runs/:id/tests`, `runs/:id/coverage`, `history`, `acceptances`,
`reports/:id`, `issues/:id`, `issues/:id/history`, `mutations/:id`. Elle sert aussi le dashboard construit
(`packages/dashboard/dist`). Aucune route d'exécution ni d'ingestion : l'orchestrateur reste l'unique
écrivaine. En-têtes : CSP stricte (`frame-ancestors` limité à `'self'` et à l'origine Orqea), `nosniff`,
`no-referrer`. Anti « DNS rebinding » : un en-tête `Host` autre que `localhost`, `127.0.0.1` ou `[::1]`
(avec le port lié quand le serveur écoute) est refusé en 403 `FORBIDDEN_HOST`. Route inconnue sous
`/api` (ou sans dashboard) et identifiant inconnu (run, issue, mutation) : JSON 404. La version
exposée est `VARIA_VERSION` de `@varia/engine` (source unique). Les écritures d'acceptations (POST/DELETE) arrivent en J2.

- `src/` — serveur. `test/` — tests (requêtes injectées, sans réseau).

Hôtes : en plus de la boucle locale, `VARIA_ALLOWED_HOSTS` (liste `nom` / `nom:port`) autorise d'autres en-têtes `Host`/`Origin` (conteneur à port publié) ; entrée invalide ⇒ erreur de configuration. Voir `docs/INTEGRATION.md`.
