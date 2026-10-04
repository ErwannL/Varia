# STATE

- Dernier jalon accepté : **J4 — extensibilité par contrat** (`reports/j4.md`) ; J3 (`reports/j3.md`) ; J2 ; J1 ; J0 GO
- Étape faite : J4 complet (P, X, T, R, S, Q, Z — `reports/j4.md`), J3 complet
- Étape en cours : **J4 FAIT** — porte franchie (CI 10/10, run 37165670453, `1fd3974`) ; prochaine étape : J5 (à définir)
- Vérification : `npm ci && npm run examples:install && npm run check` (outils : Python 3.11 + venv, PHP 8.3 + pcov + composer, Java 21 + Maven)
- Externe : `npm run external:fetch && npm run build && npm run acceptance:external`
- Preuve d'échec possible : `npm run mutation-check`
- Hook local : `.git/hooks/pre-commit` lance `npm run check:fast` (à recréer après un clone)
- Push : `origin/main` à jour
- CI GitHub Actions verte : ubuntu / macos / windows × Node 20 / 22 + external + adapter pytest / phpunit / junit (run 37165670453, `1fd3974`)
- Logo refait (D-023)

## J3 — ACCEPTÉ (`reports/j3.md`)

- **Porte J3 : franchie le 2026-10-03** (CI verte sur les 7 jobs, run 37119028207, `6ff351f` ;
  `mutation-check` 127/127 ; couverture exacte 100 % sur 104 fichiers).

- Outillage de couverture : `npm run test:coverage` (fusion des enfants) puis `npm run check:coverage-exact`
  (branché dans `npm run check`). Fichiers `runtime/` (sonde, transform, superviseur, plugin et lanceur
  Vitest) à 100 % ; seuils par fichier restants dans `coverage-thresholds.json` (cliquet :
  `node scripts/coverage-ratchet.mjs`).
- Tous les identifiants F-01 … G-06 sont FAITS (détail, commits et preuves : `reports/j3.md`).
- Avant chaque commit touchant `packages/` : `npm run build && npm run test:coverage &&
npm run check:coverage-exact` (la porte exacte fait partie de `npm run check`).
