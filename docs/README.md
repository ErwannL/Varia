# docs/

- `SPEC.md` — cahier des charges (copie intégrale, référence).
- `notes/` — règles et pièges découverts en route (un fichier par sujet).
- `INTEGRATION.md` — branchement futur sur Orqea (variables, port, iframe).
- `assets/` — images utilisées par le `README.md` racine.
- `adapter-capabilities.md` — matrice de compatibilité des adaptateurs, **générée** par
  `npm run capabilities` depuis le vrai `doctor` sur les projets d'exemple (ne pas éditer ; vérifiée
  par `npm run capabilities:check` et `tests/j4/capabilities.test.ts`, S-01).
- `probe-protocol.md`, `getting-started.md`, `configuration.md`, `oracle.md`,
  `writing-an-adapter.md`, `ci.md` — documentation produit (CDC §37).
- `extensions.md` — extensions externes (stratégies, règles d'oracle, rapporteurs, détecteurs),
  modèle de confiance, kit de test `@varia/testkit` (J4 X-02, X-03, T-01).
