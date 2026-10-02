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

- Outillage de couverture : `npm run test:coverage` (fusion des enfants) puis `npm run check:coverage-exact`.
  Pas encore branché dans `npm run check` : la sonde (`probe.cjs`) et le transform Jest ne sont pas
  encore mesurés en processus (F-03 en cours) ⇒ la porte échoue volontairement sur eux.
