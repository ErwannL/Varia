# @varia/adapter-pytest

Adapter **pytest** (J4, R-02). Seul endroit autorisé à connaître pytest. La sonde est écrite en
Python, fournie avec Varia (`runtime/varia_probe/`) : rien n'est installé dans le projet testé.

- `src/adapter.ts` — `PytestAdapter` : `detect` (version de pytest de l'interpréteur du projet :
  `.venv`, `venv`, sinon `python3`), `prepare` (fichiers de configuration de la sonde hors du projet),
  `run` (`python -m pytest -p varia_probe.plugin -p no:cacheprovider`, PYTHONPATH vers `runtime/`,
  `PYTHONDONTWRITEBYTECODE=1`, sélection exacte par nom complet, sous `runSupervised`).
- `runtime/varia_probe/` — sonde Python (norme 1.2) et plugin pytest.
- `test/` — tests de l'adapter, conformité réelle, suite Python mesurée par coverage.py (100 % lignes
  et branches), rejeu des fixtures de `packages/probe-protocol/conformance/`.

Stratégie d'injection retenue (J0) : plugin `-p` + crochet `sys.meta_path` qui publie, après exécution
d'un module ciblé, un module mandataire (`ProxyModule`) dont les fonctions exportées sont enveloppées ;
les appels internes au module (par ses globales) ne sont pas observés, comme en JavaScript.

Capacités déclarées : observation, mutation d'arguments, sélection par test, cibles async, tests
paramétrés, processus isolé. Non déclarées : `esm`/`cjs` (sans objet), `mocks`, `coverage`,
`parallelSafe`. Limites : code chargé hors du système d'import (`exec`, `runpy`) non enveloppé
(`doctor` ⇒ `UNSUPPORTED_PROBE`) ; classes non enveloppées (`unsupported`) ; `sys.exit` est une levée
synchrone (`SystemExit`), seule `os._exit` est une sortie de processus.
