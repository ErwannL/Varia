# Écrire un adapter

Implémenter `TestAdapter` (`packages/core/src/adapter.ts`) dans `packages/adapters/<nom>` :
`detect(root)`, `capabilities()`, `prepare(ctx)` (configuration éphémère **hors du projet**),
`run(options)` (un processus supervisé via `runSupervised`, renvoie résultats de tests + événements
JSONL validés par `parseProbeLog`). La sonde respecte `docs/probe-protocol.md`. Aucun code propre au
runner hors de `packages/adapters/*` (vérifié par `tests/architecture.test.ts`). Le CLI choisit
l'adapter ; le moteur et le cœur ne le connaissent pas.
