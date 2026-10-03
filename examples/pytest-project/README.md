# examples/pytest-project/

Projet d'exemple de l'adapter pytest (R-02), Python 3.9+, testé par pytest 9. Mêmes comportements de
référence que [`jest-project`](../jest-project/README.md) (§5 du jalon J4), écrits en Python.
Dépendances (`requirements.txt` : pytest, coverage) dans l'environnement virtuel local `.venv/`
(ignoré par git), créé par `npm run examples:install`.

| Fonction               | Comportement                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `create_user`          | `name` `None`/absent/`""` ⇒ `ValidationError` ; `{}`/`[]`/`123` ⇒ `TypeError` (`str.strip`) ; jamais `password`  |
| `echo_value`           | renvoie `{"received": x}` sans vérifier (ECHO)                                                                   |
| `repeat`               | boucle `while n != 0` : infinie pour `None`, négatif, décimal, objet… (TIMEOUT)                                  |
| `exit_on`              | `os._exit(1)` si `"boom"` ; `sys.exit(2)` si `"quit"`                                                            |
| `stamp`                | `label:time_ns()` (argument non déterministe pour `echo_value`)                                                  |
| `fetch_user`           | objet ⇒ `TypeError` **synchrone** ; sinon coroutine qui rejette `ValidationError` (non entier positif) ou résout |
| `outer` → `text.inner` | appel transitif via l'export d'un autre module (profondeurs 0 et 1, tâches `asyncio.gather`)                     |
| `sum_local` → `helper` | appel interne au même module (par ses globales : non observé, listé `NEVER_CALLED`)                              |
| `schedule_welcome`     | crée une tâche asyncio sans l'attendre : `email` non textuel ⇒ exception jamais récupérée après un retour normal |
| `TestCreateUser`       | test paramétré (`parametrize`, 3 cas), `create_user` appelé 3 fois dans un test, mots de passe                   |

`varia.yml` : `execution.timeout_ms: 5000` (pas de `test.framework` tant que le CLI n'accepte pas
`pytest`). Scénarios : `tests/j4/pytest*.test.ts`. Dossiers `src/` et `tests/` : données.
