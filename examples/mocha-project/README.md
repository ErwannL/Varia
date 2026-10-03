# examples/mocha-project/

Projet d'exemple de l'adapter Mocha (R-01), CommonJS, testé par Mocha 11 (`node:assert`). Mêmes
comportements de référence que [`jest-project`](../jest-project/README.md) (§5 du jalon J4) ; seuls
les tests changent (Mocha `describe` / `it`, test paramétré par boucle sur `it`).

| Export                 | Comportement                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `createUser`           | `null`/`undefined`/`""` (après trim) ⇒ `ValidationError` ; `{}`/`[]`/`123` ⇒ `TypeError` ; ne renvoie jamais `password` |
| `echoValue`            | renvoie `{ received: x }` sans vérifier (ECHO)                                                                          |
| `repeat`               | boucle `while (n !== 0) n--` : infinie pour NaN, décimal, négatif, null… (TIMEOUT)                                      |
| `exitOn`               | `process.exit(1)` si `"boom"`                                                                                           |
| `stamp`                | `label + ":" + Date.now()` (argument non déterministe pour `echoValue`)                                                 |
| `fetchUser`            | objet ⇒ `TypeError` **synchrone** ; non entier positif ⇒ promesse rejetée `ValidationError` ; sinon résolue             |
| `outer` → `text.inner` | appel transitif via l'export d'un autre module (profondeurs 0 et 1)                                                     |
| `sumLocal` → `helper`  | appel interne au même fichier (non observable, listé `NEVER_CALLED`)                                                    |
| `scheduleWelcome`      | lance un envoi sans l'attendre : `email` non textuel ⇒ rejet **non géré** après un retour normal                        |

`.mocharc.json` : `spec: tests/**/*.test.js`. `varia.yml` : `test.framework: mocha`,
`execution.timeout_ms: 3000`. Scénarios : `tests/j4/mocha*.test.ts`. Dossiers `src/` et `tests/` :
contenu lu comme données par Varia (pas de README, comme `jest-project`).
