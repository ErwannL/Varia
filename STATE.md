# STATE

- Dernier jalon accepté : **J0 — GO** (stratégie D1), rapport `reports/j0.md`
- Étape faite : J0 complet (scénarios J0-1 à J0-20, mesures, mutation-check)
- Étape en cours : J1 — paquets probe-protocol, probe-runtime, core faits ; suivants : config, database, adapter-jest, engine, cli
- Vérification : `npm ci && npm run examples:install && npm run check`
- Preuve d'échec possible : `npm run mutation-check -- spike/mutation-cases.json`
- Push : `origin/main` à jour
