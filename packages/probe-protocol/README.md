# @varia/probe-protocol

Contrat entre la sonde (dans le processus de test) et l'orchestrateur (CDC §10.6, §40, D.0) :
types des messages JSONL, schéma Zod de validation ligne à ligne (`parseProbeLog`), version du
protocole, noms des variables d'environnement. Spécification lisible : `docs/probe-protocol.md`.

- `src/` — code. `test/` — tests.
