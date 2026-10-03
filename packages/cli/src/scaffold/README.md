# src/scaffold/

Gabarits de `varia scaffold adapter|strategy|rule|reporter <nom>` (J4 T-02), en chaînes dans le code :
contenu fixe, sans date ni chemin absolu (mêmes type et nom ⇒ mêmes octets), conforme à Prettier une
fois généré. Preuve : `tests/j4/scaffold.test.ts` (chaque squelette compile et ses tests passent).

- `index.ts` — validation (type, nom, dossier cible absent ou vide) et écriture.
- `common.ts` — nom (motif, longueur maximale, PascalCase) et fichiers communs (tsconfig, Prettier).
- `adapter.ts` — paquet `TestAdapter` délégant au lanceur Vitest, test unitaire, suite de conformité.
- `plugin.ts` — extension (stratégie, règle d'oracle, rapporteur) et son test par `@varia/testkit`.
