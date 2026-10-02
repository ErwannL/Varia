# Chemins multiplateformes

- La racine d'un projet est **canonisée** (`canonicalRoot`, `realpathSync.native`) : macOS place
  `tmpdir()` sous `/var` (lien vers `/private/var`), Windows peut donner des noms courts (`RUNNER~1`).
  La sonde, Node et git rapportent des chemins réels ; comparer à une racine non canonique fait sortir
  tous les fichiers du projet.
- Tout test qui ouvre un projet par un chemin non canonique doit passer : `tests/j1/paths.test.ts`
  (lien symbolique, reproduit le cas macOS sous Linux).
- Dans les tests, comparer des chemins relatifs avec `/` : utiliser `path.posix` ou normaliser
  `split(sep).join('/')`, jamais `path.join` suivi d'une comparaison de chaînes.
