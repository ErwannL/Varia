# STATE

- Dernier jalon accepté : **J3 — produit fiable** (`reports/j3.md`) ; J2 (`reports/j2.md`) ; J1 ; J0 GO
- Étape faite : J3 complet (audit F/A/B/C/D/E/G, couverture 100 %, CI verte multi-OS)
- Étape en cours : **J4 — Q-03 (exemples/CI) puis Z-01 (rapport)** ; faits : P-01…P-03, X-01…X-03, T-01, T-02, R-01…R-04, S-01, Q-01, Q-02 (DECISIONS D-037 … D-045)
- Vérification : `npm ci && npm run examples:install && npm run check` (outils : Python 3.11 + venv, PHP 8.3 + pcov + composer, Java 21 + Maven)
- Externe : `npm run external:fetch && npm run build && npm run acceptance:external`
- Preuve d'échec possible : `npm run mutation-check`
- Hook local : `.git/hooks/pre-commit` lance `npm run check:fast` (à recréer après un clone)
- Push : `origin/main` à jour
- CI GitHub Actions verte sur ubuntu / macos / windows × Node 20 / 22 + external (run 37159966128, `77504f0`, J4 adaptateurs inclus)
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
