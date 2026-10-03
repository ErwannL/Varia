# conformance/

Jeu de conformité du protocole de sonde (P-02) : des cas « entrée → sortie attendue » **indépendants
du langage**. Toute sonde (JavaScript, Python, PHP, Java…) les rejoue avec **sa propre
implémentation** ; elle est conforme si elle produit toutes les sorties attendues. Norme :
`docs/probe-protocol.md`. Rejeu de référence (JavaScript) : `packages/probe-runtime/test/conformance.test.ts`.

- `manifest.json` — version du protocole (`"1.1"`), liste des fichiers de cas, empreinte `sha256`.
- `cases/*.json` — un fichier par thème : `{ "description": "…", "cases": [ { "id", "op", "input", "expected" } ] }`.

## Manifeste et version

`sha256` = SHA-256 de la concaténation, pour chaque fichier de `cases/` par ordre de nom (octets), de
`nom` + octet NUL + `contenu (UTF-8, LF)` + octet NUL. Une fixture modifiée change l'empreinte : il
faut alors **changer la version du protocole** (mineure au moins) et mettre à jour le manifeste dans le
même commit (`packages/probe-protocol/test/conformance.test.ts` échoue sinon). Une sonde peut vérifier
l'empreinte pour savoir quelle version du jeu elle rejoue.

## Entrées : vocabulaire neutre

Chaque langage **construit** la valeur native correspondante avant de la passer à sa sonde :

| Entrée JSON                                                   | Valeur à construire                                                                                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `null`, booléen, chaîne, nombre fini                          | la valeur primitive (un nombre entier JSON reste un entier ; `1.5` un flottant)                                                                                        |
| tableau JSON `[…]`                                            | une liste/tableau ordonné, éléments construits récursivement                                                                                                           |
| objet JSON **sans** clé `$in`                                 | un objet « simple » (dict/tableau associatif) avec ces clés, dans cet ordre                                                                                            |
| `{"$in":"object","entries":[[clé,valeur],…]}`                 | idem, pour des clés quelconques (`$in`, `__proto__`, `constructor`) — clés **propres**                                                                                 |
| `{"$in":"instance","class":"Point","entries":[…]}`            | une instance d'une classe utilisateur nommée `Point` dont les champs sont `entries`                                                                                    |
| `{"$in":"undefined"}`                                         | la valeur « absente » du langage (JS `undefined` ; voir la norme pour les autres)                                                                                      |
| `{"$in":"number","v":"NaN"\|"Infinity"\|"-Infinity"\|"-0"}`   | le flottant spécial                                                                                                                                                    |
| `{"$in":"bigint","v":"123…"}`                                 | un entier hors de ±(2^53−1) (les cas n'utilisent que de tels entiers)                                                                                                  |
| `{"$in":"date","v":"2024-02-29T23:59:59.123Z"}`               | un instant (date-heure UTC, millisecondes)                                                                                                                             |
| `{"$in":"map","entries":[[k,v],…]}`                           | une table associative à clés quelconques (les cas contiennent toujours une clé non-chaîne)                                                                             |
| `{"$in":"set","values":[…]}`                                  | un ensemble, dans l'ordre d'insertion                                                                                                                                  |
| `{"$in":"bytes","base64":"…"}`                                | une suite d'octets                                                                                                                                                     |
| `{"$in":"error","name","message","code"?,"status"?,"chain"?}` | une erreur : classes `chain` (de la plus dérivée à la plus générale) au-dessus de la classe d'erreur standard du langage ; champs `code`/`status` posés sur l'instance |
| `{"$in":"function","name":"rappel"}`                          | une fonction nommée `rappel`                                                                                                                                           |
| `{"$in":"string","repeat":"a","times":4097}`                  | la chaîne répétée                                                                                                                                                      |
| `{"$in":"array","repeat":v,"times":201}`                      | une liste de `times` copies de `v`                                                                                                                                     |
| `{"$in":"nest","key":"a","depth":10,"leaf":v}`                | `{a:{a:…{a:v}}}` avec `depth` niveaux d'objets                                                                                                                         |
| `{"$in":"self"}`                                              | une référence au conteneur englobant le plus proche (référence circulaire)                                                                                             |

## Opérations (`op`)

| `op`             | `input`                                                                                           | Sortie comparée à `expected`                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `serialize`      | `value`                                                                                           | valeur étiquetée (chemin racine vide, plafonds par défaut)                         |
| `serializeArgs`  | `args`, `export`?, `redact`? (`fields`, `patterns`, `skipPaths`, `hmacKey`, comme `VARIA_REDACT`) | `{ "args": [valeurs étiquetées], "argsFingerprint": hex }`                         |
| `serializeError` | `error`, et optionnellement `args`/`export`/`redact`                                              | erreur sérialisée ; les chaînes masquées dans `args` sont retirées du message/pile |
| `testId`         | `file`, `name`, `rank`                                                                            | identifiant de test                                                                |
| `callSiteId`     | `testId`, `module`, `export`, `depth`, `sequence`                                                 | identifiant de call site                                                           |
| `canonical`      | `value` (JSON), `indent` (0 ou 2)                                                                 | `{ "text": JSON canonique, "sha256": hex de text }`                                |

`export` vaut `"f"` par défaut. Les motifs de `redact.patterns` sont des expressions régulières
simples (ancres `^`/`$`, classes `[_-]`, `?`) appliquées **sans tenir compte de la casse**.

## Comparaison

Égalité JSON stricte (l'ordre des clés d'un objet est indifférent, `-0` ≠ `0`), sauf deux jokers :
`{"$match":"string"}` (toute chaîne : pile, nom de la classe d'erreur standard, `kind` des octets) et
`{"$prefix":[…]}` (tableau qui commence par ces éléments : `constructorChain`, que la sonde complète
par les classes standard de son langage).

## Rejouer depuis une autre sonde

1. Lire `manifest.json`, vérifier `protocolVersion` et, si souhaité, l'empreinte.
2. Pour chaque cas de chaque fichier : construire l'entrée, appeler la fonction correspondante de la
   sonde, convertir la sortie en JSON, comparer avec `expected` selon les règles ci-dessus.
3. Un cas non rejouable (concept absent du langage) est signalé comme tel, jamais compté réussi.
