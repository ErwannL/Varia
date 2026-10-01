# STATE

- Dernier jalon accepté : **J1 — cœur minimal Jest** (`reports/j1.md`) ; J0 GO (`reports/j0.md`)
- Étape faite : J1 complet (acceptation 1 à 6, projet externe validé, spike supprimé)
- Étape en cours : J2 — non commencé
- Vérification : `npm ci && npm run examples:install && npm run check` (≈ 3 min)
- Externe : `npm run external:fetch && npm run build && npm run acceptance:external`
- Preuve d'échec possible : `npm run mutation-check`
- Hook local : `.git/hooks/pre-commit` lance `npm run check:fast` (à recréer après un clone)
- Push : `origin/main` à jour
