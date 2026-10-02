# STATE

- Dernier jalon accepté : **J2 — utilisation réelle Jest + Vitest, CI** (`reports/j2.md`) ; J1 (`reports/j1.md`) ; J0 GO (`reports/j0.md`)
- Étape faite : J2 complet (états d'issues, formats CI, acceptations, Vitest, `--changed`, cache, couverture, dashboard N2, destr validé)
- Étape en cours : aucune (plan J0 → J2 terminé)
- Vérification : `npm ci && npm run examples:install && npm run check` (≈ 8 min)
- Externe : `npm run external:fetch && npm run build && npm run acceptance:external`
- Preuve d'échec possible : `npm run mutation-check`
- Hook local : `.git/hooks/pre-commit` lance `npm run check:fast` (à recréer après un clone)
- Push : `origin/main` à jour
- CI GitHub Actions verte sur ubuntu / macos / windows × Node 20 / 22 + external (run 32, `793db7d`)
- Logo refait (D-023)

## J3 (en cours)

- Outillage de couverture : `npm run test:coverage` (fusion des enfants) puis `npm run check:coverage-exact`
  (branché dans `npm run check`). Fichiers `runtime/` (sonde, transform, superviseur, plugin et lanceur
  Vitest) à 100 % ; seuils par fichier restants dans `coverage-thresholds.json` (cliquet :
  `node scripts/coverage-ratchet.mjs`).
- Fait : F-01 (outillage), F-03 (sonde en processus), A-01…A-10, A-13, B-01, B-02 (CLI découpé en
  `commands/`, adapter injectable pour les tests, `prune`, `db check|backup`, `list`, `version`,
  `oracle suggest`, ciblage, `--keep-tmp`), B-04, B-05 (clés inconnues = avertissement), B-06, C-02,
  B-08 (hôte validé, 404 JSON, version unique ; reste : OpenAPI, `/tests/:id`, alias `/api/v1`),
  D-03 (gabarits CI), G-01, G-05, G-06, couverture 100 % sur les 94 fichiers mesurés (aucun seuil
  < 100 dans `coverage-thresholds.json`), CI macOS/Windows corrigée (à confirmer sur le run suivant).
- À faire : A-12, A-14 (affichage), B-03 (doc), B-07, B-08 (reste), B-09, C-01, D-01, D-02, E-01…E-09,
  F-02 (trois passages), G-02 (CI à constater), rapport `reports/j3.md`.
- Avant chaque commit touchant `packages/` : `npm run build && npm run test:coverage &&
npm run check:coverage-exact` (la porte exacte fait partie de `npm run check`).
