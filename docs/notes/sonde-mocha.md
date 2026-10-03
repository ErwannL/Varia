# Sonde sous Mocha (R-01)

- **Injection** : `--require` d'un fichier généré hors du projet (`varia-mocha-setup.cjs`) qui pose un
  crochet sur `Module._extensions` (`.js`, `.cjs`) puis exporte `mochaHooks` (crochets racine
  `beforeEach` / `afterEach` → `install` de la sonde, test courant lu sur `this.currentTest`, nom =
  `fullTitle()`, identique au rapporteur JSON). La sonde (`probe-runtime`) n'est pas modifiée.
- **ESM natif** (`"type": "module"`) : `module.register` d'`esm-hooks.mjs` dans le même setup, avant
  le chargement des fichiers de test ; réécriture par `rewrite.mjs` de l'adapter Vitest. Le fil des
  chargeurs coûte ~100 ms par processus et TypeScript ~450 ms au premier module ciblé : crochets
  enregistrés pour un projet `"type": "module"` seulement, réécriture chargée paresseusement.
- **`spec` est concaténé** entre la configuration et la ligne de commande : un fichier passé en argument
  n'en remplace pas la liste. Varia lit la configuration du projet avec `loadOptions` de la copie de
  Mocha du projet, puis écrit une configuration complète par exécution (`--config <généré>
--no-package`) où `spec` est remplacé.
- `findConfig` renvoie `undefined` (pas `null`) sans `.mocharc.*` ; `spec: []` désactiverait le défaut
  `./test` : la clé est omise.
- **`--grep`** : Mocha lit la chaîne avec `/^\/(.*)\/…$|.*/` (`.` sans drapeau `s`) : nom échappé,
  ancré, et fins de ligne écrites en `\uXXXX`.
- Rapport : rapporteur `json` avec `reporter-option output=<fichier du run>` (jamais stdout, que les
  tests du projet peuvent polluer). Processus tué ou mort ⇒ pas de rapport ⇒ `tests: null`.
- Couverture des fichiers `runtime/*.mjs` chargés par `createRequire` : le rapport texte local de
  Vitest est faux pour le code après un `await` ; seule la fusion des couvertures brutes
  (`VARIA_CHILD_COVERAGE` + `mergeChildren`, comme `scripts/coverage.mjs`) fait foi.

## Node ≥ 20.19 : require(esm)

- Mocha 11 charge les fichiers par `require()` quand `process.features.require_module` est vrai
  (Node 20.19+, 22.12+). Sous Node 20, un module ESM chargé par require(esm) ne passe PAS par les
  crochets asynchrones de `module.register` : aucune cible ESM n'était enveloppée (CI Node 20 rouge,
  `observation : []`). Projet ESM ⇒ Node lancé avec `--no-experimental-require-module`, Mocha
  repasse par `import()`. Reproduction locale : binaire Node 20 (`npm pack node-linux-x64@20`).
