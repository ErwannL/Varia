# examples/jest-project/

Projet d'exemple **normatif** (CDC C.0), CommonJS, testé par Jest 29. Aucune dépendance runtime.
Il sert de cible aux scénarios d'acceptation J0/J1 ; ses comportements sont imposés :

| Export                 | Comportement                                                                                                            | Scénario            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `createUser`           | `null`/`undefined`/`""` (après trim) ⇒ `ValidationError` ; `{}`/`[]`/`123` ⇒ `TypeError` ; ne renvoie jamais `password` | J0-3/4/5/6/11/12/15 |
| `echoValue`            | renvoie `{ received: x }` sans vérifier                                                                                 | J0-18 (ECHO)        |
| `repeat`               | boucle `while (n !== 0) n--` : infinie pour NaN, décimal, négatif, null… ; `"3"` termine                                | J0-8 (TIMEOUT)      |
| `exitOn`               | `process.exit(1)` si `"boom"`                                                                                           | J0-9                |
| `stamp`                | `label + ":" + Date.now()` (argument non déterministe pour `echoValue`)                                                 | J0-13               |
| `fetchUser`            | objet ⇒ `TypeError` **synchrone** ; non entier positif ⇒ promesse rejetée `ValidationError` ; sinon résolue             | J0-14               |
| `outer` → `text.inner` | appel transitif via l'export d'un autre module                                                                          | J0-16               |
| `sumLocal` → `helper`  | appel interne au même fichier (non observable)                                                                          | J0-17               |
| `scheduleWelcome`      | lance un envoi sans l'attendre : `email` non textuel ⇒ rejet **non géré** après un retour normal                        | A-02 (J3)           |

**J0-5 documenté :** `createUser({ name: "" })` lève `ValidationError` (chaîne vide après `trim`) ⇒ `HANDLED`.

`fetchUser` n'est pas déclarée `async` : une fonction `async` ne peut pas lever synchroniquement,
alors que C.0 l'exige pour un objet. Elle renvoie une promesse dans tous les autres cas.

`varia.yml` fixe `execution.timeout_ms: 3000`. Dossiers `src/` et `tests/` : contenu lu comme
données par Varia (pas de README).
