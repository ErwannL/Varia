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
- Fait : F-01 (outillage), F-03 (sonde en processus), A-01…A-10, A-13, B-01, C-02.
- À faire : A-11, A-12, A-14 (affichage), A-15 (vérif), B-02…B-10, C-01, D, E, F-02, F-04 (cas
  restants), G, couverture 100 % des `src/` (cliquet dans `coverage-thresholds.json`).
- Avant chaque commit touchant `packages/` : `npm run build && npm run test:coverage &&
  npm run check:coverage-exact` (la porte exacte fait partie de `npm run check`).
