# @varia/engine

Orchestrateur (CDC §7) : **seule écrivaine de la base**. Il pilote un `TestAdapter` (injecté par le
CLI : le moteur ne connaît aucun runner) à travers les phases :

- `baseline.ts` — baseline + stabilité (§8), statuts des targets (§11), catalogue persisté.
- `planning.ts` — plan déterministe par graine, estimation de durée (§35), import `--plan`.
- `fuzz.ts` — exécution séquentielle, 1 mutation = 1 processus (§16), persistance immédiate,
  reprise idempotente, regroupement des issues (§20), vérification d'intégrité (§5).
- `replay.ts` — rejeu d'une mutation (§42). `doctor.ts` — capacités vérifiées (§9.2).
- `context.ts` — configuration, stockage utilisateur, base, journal pino. `errors.ts` — codes de sortie.

Sous-dossiers : `src/`, `test/`.
