# src/

- `server.ts` : en-têtes de sécurité, validation Host/Origin (anti DNS rebinding), enregistrement des routes.
- `routes.ts` : SOURCE UNIQUE des routes (`defineRoutes`) : gestionnaires, paramètres, schémas de réponse.
- `openapi.ts` : constructeurs de schémas et génération du document OpenAPI 3.1 à partir des définitions
  (`/api/v1/openapi.json`) ; un test échoue si une route enregistrée n'y figure pas.
- `aggregates.ts` : agrégats par run (rapport, arbre dossiers/fichiers/tests/call sites, mutations
  enrichies), mémoïsés pour les runs terminés (immuables) ; pagination côté serveur partout.
