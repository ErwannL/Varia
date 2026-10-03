# docs/

Documentation produit (CDC §37) :

- `getting-started.md` — installation et premières commandes.
- `configuration.md` — `varia.yml`.
- `oracle.md` — statuts et règles de l'oracle.
- `ci.md` (et `ci/`) — `varia ci` et intégration continue.
- `writing-an-adapter.md` — pas à pas d'un adapter (`varia scaffold adapter`, suite de conformité,
  `doctor`), stratégie d'injection et limites de chaque adaptateur existant, adaptateur `custom`.
- `adapter-capabilities.md` — matrice de compatibilité des adaptateurs, **générée** par
  `npm run capabilities` depuis le vrai `doctor` sur les projets d'exemple (ne pas éditer ; vérifiée
  par `npm run capabilities:check` et `tests/j4/capabilities.test.ts`, S-01).
- `probe-protocol.md` — norme du protocole de sonde 1.2, JSON Schema, jeu de conformité, sondes
  Python/PHP/Java et cas non rejouables.
- `extensions.md` — extensions externes (stratégies, règles d'oracle, rapporteurs, détecteurs),
  modèle de confiance, kit de test `@varia/testkit`, squelettes scaffold (J4 X-02, X-03, T-01, T-02).

Référence et annexes :

- `SPEC.md` — cahier des charges (copie intégrale, référence).
- `notes/` — règles et pièges découverts en route (un fichier par sujet).
- `INTEGRATION.md` — branchement futur sur Orqea (variables, port, iframe).
- `assets/` — images utilisées par le `README.md` racine.
