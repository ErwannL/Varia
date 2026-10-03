# examples/junit-project/

Projet d'exemple de l'adaptateur JUnit (R-04) : Maven, Java 21, JUnit Jupiter 5.11.4 (versions
épinglées dans `pom.xml`, `target/` ignoré). Mêmes comportements de référence que
[`jest-project`](../jest-project/README.md) (§5 du jalon J4), en Java.

| Cible (classe#méthode)          | Comportement                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Users#createUser(Map)`         | `name` absent/null/vide ⇒ `ValidationException` ; d'un autre type ⇒ `ClassCastException`             |
| `Values#echoValue(Object)`      | renvoie `{ received: x }` sans vérifier (ECHO)                                                       |
| `Values#repeat(String, double)` | boucle `while (n != 0) n -= 1` : infinie pour NaN, décimal, négatif (TIMEOUT)                        |
| `Values#exitOn(String)`         | `System.exit(1)` si `"boom"`                                                                         |
| `Values#stamp(String)`          | valeur non déterministe (`System.nanoTime()`) passée à `echoValue`                                   |
| `Users#fetchUser(Object)`       | Map/List ⇒ `ClassCastException` **synchrone** ; non entier positif ⇒ future en échec ; sinon réussie |
| `Chain#outer` → `Text#inner`    | appel vers une autre classe cible (profondeurs 0 et 1)                                               |
| `MathOps#sumLocal` → `helper`   | appel interne à une méthode privée (non observée, listée `unsupported`)                              |
| `Notify#scheduleWelcome(Map)`   | envoi dans un fil non attendu : `email` non textuel ⇒ exception non attrapée après un retour normal  |

Tests : un test paramétré (`@ParameterizedTest`), trois appels de `createUser` dans un test, des mots
de passe (`password`, masqué par la sonde). Installation : `npm run examples:install` (résout les
dépendances Maven en ligne ; un run Varia les utilise ensuite hors ligne, `mvn -o`).
Scénarios : `tests/j4/junit*.test.ts`. `src/` : contenu lu comme données par Varia (pas de README).
