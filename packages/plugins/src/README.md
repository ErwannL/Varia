# src/

- `contracts.ts` — contrats publics des extensions et `PLUGIN_API_VERSION`.
- `session.ts` — chargement, validation, ordre et conflits d'identifiants, appels, `PLUGIN_FAILURE`.
- `host.ts` — thread d'un plugin appelé de façon synchrone avec délai (`Atomics.wait`).
- `oracle.ts` — entrée d'une règle d'oracle et application de son verdict.
