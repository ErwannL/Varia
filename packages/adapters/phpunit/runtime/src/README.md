# packages/adapters/phpunit/runtime/src/

| Fichier          | Rôle                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------- |
| `Json.php`       | JSON du protocole : nombres ECMAScript, échappement `JSON.stringify`, clés canoniques |
| `Absent.php`     | sentinelle « absent » (`{"$t":"undefined"}`) : argument omis, clé retirée             |
| `Serializer.php` | valeurs étiquetées, redaction avant écriture, erreurs (`constructorChain`), identités |
| `Mutation.php`   | copie profonde, application d'UNE mutation, reconstruction des valeurs étiquetées     |
| `Probe.php`      | état, messages JSONL (écrits ligne à ligne), observation, plan, `AMBIGUOUS_CALL_SITE` |
| `Rewriter.php`   | réécriture du source d'une classe : enveloppe des méthodes publiques                  |
| `Loader.php`     | chargeur d'autoload enveloppant (copies réécrites dans le dossier du run)             |
| `Extension.php`  | extension PHPUnit : TEST_START/TEST_END, résultats, mode liste                        |
| `Boot.php`       | démarrage dans le processus PHPUnit                                                   |

Équivalents PHP des valeurs : `int` hors ±(2^53−1) ⇒ `bigint` ; chaîne non UTF-8 ⇒ `bytes`
(`kind: "string"`) ; `array` liste ⇒ tableau, `array` associatif et `stdClass` ⇒ objet simple ; objet ⇒
`{"$t":"object","ctor":<nom court>}` (propriétés de toute visibilité) ; `DateTimeInterface` ⇒ `date`
(UTC, ms) ; `Throwable` ⇒ `error` ; `SplObjectStorage` ⇒ `map` ; `Closure` ⇒ opaque `function` ;
ressource, `Generator`, `Fiber` ⇒ opaque. Erreurs : `name` = nom court de la classe, `code` =
`getCode()` s'il est non nul, `status` = propriété numérique `status`, `constructorChain` = classes
parentes (noms courts, sans interface). Objet JSON vide reconstruit en `stdClass` (un tableau vide serait
une liste).
