# @varia/probe-protocol

Contrat entre la sonde (dans le processus de test) et l'orchestrateur (CDC §10.6, §40, D.0) : un
schéma Zod par message JSONL (`src/messages.ts`, union discriminée sur `type`), lecture ligne à ligne
(`parseProbeLog`), versions majeure/mineure et refus d'une majeure inconnue (`unsupportedProbeVersion`),
noms des variables d'environnement. Norme lisible : `docs/probe-protocol.md`.

- `src/` — code. `test/` — tests.
- `schema/` — JSON Schema de chaque message, générés (`npm run schemas`).
- `conformance/` — jeu de conformité indépendant du langage, rejoué par chaque sonde.
