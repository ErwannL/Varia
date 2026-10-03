# examples/phpunit-project/

Projet d'exemple de l'adapter PHPUnit (R-03), PHP 8.2+, PHPUnit 11.5.2 épinglé (Composer, `vendor/`
ignoré par git, installé par `npm run examples:install`). Comportements de référence du §5 (J4)
transposés en PHP :

| Cible                                   | Comportement                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `Users::createUser`                     | `name` absent/`null`/vide ⇒ `ValidationError` ; tableau, objet, nombre ⇒ `TypeError` |
| `Values::echoValue`                     | renvoie `['received' => $x]` sans vérifier (ECHO)                                    |
| `Values::repeat`                        | `while ($n !== 0) $n--` : infinie pour négatif, décimal, `null` (TIMEOUT)            |
| `Values::exitOn`                        | `exit(1)` pour `"boom"`                                                              |
| `Values::stamp`                         | `hrtime()` : argument non déterministe pour `echoValue`                              |
| `Chain::outer` → `Text::inner`          | appel transitif (profondeurs 0 et 1)                                                 |
| `MathOps::sumLocal` → `helper`/`double` | `helper` (publique) observée à la profondeur 1 ; `double` (privée) jamais observée   |

Test paramétré : `#[DataProvider]` + `#[TestDox('createUser accepte $name ($age ans)')]` ; trois
appels dans un test ; mot de passe dans les arguments. Asynchrone : **NOT FEASIBLE** (PHP n'a pas de
promesse ; les Fibers sont des coroutines coopératives sans rejet non géré). Scénarios :
`tests/j4/phpunit*.test.ts`. Dossiers `src/` et `tests/` : données lues par Varia.
