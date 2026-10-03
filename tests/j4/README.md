# tests/j4

Scénarios d'acceptation du jalon J4 (plateforme extensible par contrat), lancés par le vrai CLI sur
les projets d'exemple (`examples/`). Chaque fichier cite l'identifiant du point traité (P-01…).
Tout ce qui est écrit l'est dans des dossiers temporaires.

`capabilities.test.ts` (S-01) régénère la matrice par le vrai `doctor` (une passe par adaptateur) et
échoue si `docs/adapter-capabilities.md` diverge ou si un adaptateur n'a pas pu être mesuré.

`scaffold.test.ts` (T-02) génère chaque squelette de `varia scaffold` dans un dossier temporaire et
y exécute Prettier, `tsc --noEmit` et `vitest run` (dont la suite de conformité d'adaptateur).
