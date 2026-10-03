# @varia/adapter-mocha

Adapter **Mocha** (J4, R-01). Seul endroit (avec les autres `adapters/*`) autorisé à connaître Mocha.

- `src/adapter.ts` — `MochaAdapter` : `detect` (version de Mocha du projet), `prepare` (lit la
  configuration du projet avec **sa** copie de Mocha — `loadOptions`, `.mocharc.*`, `package.json` —
  et écrit hors du projet le fichier de setup chargé par `--require`), `run` (une configuration par
  exécution dans le dossier du run : fichiers, `--grep` exact, rapporteur JSON vers un fichier, série ;
  lancement de `mocha/lib/cli/cli.js --config <généré> --no-package` sous `runSupervised`).
- `runtime/register.cjs` — crochet de chargement CommonJS (`Module._extensions` `.js` / `.cjs`) qui
  enveloppe les exports des modules `targets.include`, et crochets racine Mocha (`mochaHooks`) qui
  alimentent la sonde (`@varia/probe-runtime`, inchangée).
- `runtime/esm-hooks.mjs` — crochets de chargement ESM (`module.register`) : réécriture des exports des
  modules ESM ciblés par `rewrite.mjs` de l'adapter Vitest (chargé au premier module ESM ciblé).
- `test/` — tests (en processus pour `runtime/`, conformité réelle CJS et ESM).

Capacités déclarées : observation, mutation d'arguments, sélection par test, cibles async, ESM, CJS,
tests paramétrés, processus isolé. Non déclarées : `mocks`, `coverage` (Mocha ne mesure pas la
couverture), `parallelSafe`. Limites : appels internes à un module non observés (comme Jest/Vitest) ;
code chargé hors du chargeur de modules (`vm`, `eval`) non enveloppé (`doctor` ⇒ `UNSUPPORTED_PROBE`).
