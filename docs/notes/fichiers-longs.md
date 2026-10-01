# Limite de 1000 lignes par fichier

`npm run check:lines` échoue si un fichier texte suivi dépasse 1000 lignes. Exemptions (seulement) :

- `package-lock.json` (racine et `examples/*`) : générés par npm, jamais édités à la main ;
- `docs/SPEC.md` : copie intégrale imposée de la spécification (« mot pour mot »).
  Tout autre fichier long se **scinde** (jamais de compression de code).
