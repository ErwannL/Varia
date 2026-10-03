# examples/plugins-project/

Projet cible des tests de bout en bout des extensions (J4 X-02, `tests/j4/plugins-e2e.test.ts`) :
`transfer({ iban, amount, token })` refuse un IBAN invalide par une erreur de code
`E_VALIDATION_IBAN` (refus propre selon la règle `examples/plugins/oracle-codes`) mais plante
(TypeError) sur un pays inconnu — défaut que seule la stratégie `examples/plugins/iban` révèle.
`token` est un secret (masqué par la sonde). Dépendances : `npm run examples:install`.

- `src/` — code testé.
- `tests/` — tests Jest.
