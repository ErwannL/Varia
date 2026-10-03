# Protocole de la sonde — norme, version 1.2

Contrat entre une **sonde** (code chargé dans le processus de test, dans n'importe quel langage) et
l'**orchestrateur** Varia (CDC §10, §40, D.0). Une sonde conforme permet d'ajouter un lanceur de
tests sans modifier le cœur. Les mots **DOIT**, **NE DOIT PAS**, **DEVRAIT**, **PEUT** ont le sens
habituel des normes (obligation, interdiction, recommandation, option).

| Élément                          | Où                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| Schémas (source de vérité)       | `packages/probe-protocol/src/messages.ts` (Zod), lecture : `parseProbeLog`             |
| JSON Schema publiés (générés)    | `packages/probe-protocol/schema/<type>.schema.json`, union `probe-message.schema.json` |
| Jeu de conformité                | `packages/probe-protocol/conformance/` (format : son `README.md`)                      |
| Implémentation de référence (JS) | `packages/probe-runtime/runtime/probe.cjs`, `serialize.cjs`                            |

## 1. Rôle de la sonde

La sonde **observe** chaque appel d'une fonction cible (« target ») à sa frontière : arguments, issue
(retour, levée synchrone, rejet asynchrone), durée. En mode `fuzz`, elle applique **au plus une**
mutation, sur une **copie** des arguments, à l'appel désigné par le plan. Elle n'a **aucune
politique** : elle ne classe rien (l'oracle juge) ; elle n'écrit que des fichiers locaux ; elle
n'utilise jamais le réseau ; elle ne modifie jamais le projet testé.

Une sonde DOIT être **défensive** : une erreur de son propre code (valeur hostile, disque plein) est
signalée par `PROBE_ERROR` et la cible est appelée **sans mutation**, avec ses arguments d'origine ;
l'erreur de la sonde n'atteint jamais le code testé. Si le journal est inaccessible, elle écrit sur la
sortie d'erreur une ligne commençant par `[varia] PROBE_ERROR`.

## 2. Entrées : variables d'environnement

Toutes les entrées passent par l'environnement du processus de test et par des fichiers JSON locaux.

| Variable            | Contenu                                                                                         | Obligatoire    |
| ------------------- | ----------------------------------------------------------------------------------------------- | -------------- |
| `VARIA_MODE`        | `observe` ou `fuzz` ; toute autre valeur (ou absence) ⇒ la sonde reste **inactive**, sans effet | oui            |
| `VARIA_RUN_DIR`     | dossier où écrire les journaux JSONL (absent ⇒ sonde inactive)                                  | oui            |
| `VARIA_TARGETS`     | **chemin** d'un fichier JSON `{ "runId": string, "projectRoot": string }`                       | oui            |
| `VARIA_REDACT`      | **chemin** d'un fichier JSON `{ "fields": [], "patterns": [], "skipPaths": [], "hmacKey": "" }` | oui            |
| `VARIA_PLAN`        | **chemin** du plan JSON (§9)                                                                    | en mode `fuzz` |
| `VARIA_MUTATION_ID` | identifiant de la seule mutation à appliquer dans ce processus                                  | en mode `fuzz` |

`projectRoot` sert à calculer les chemins relatifs (POSIX, séparateur `/`) des fichiers de test et des
modules. Un fichier absent ou illisible ⇒ valeurs par défaut (`runId` vide, aucune redaction, clé
HMAC `varia`) — l'orchestrateur fournit toujours ces fichiers. En mode `fuzz`, une mutation introuvable
dans le plan ⇒ la sonde observe sans muter.

## 3. Sortie : journaux JSON Lines

- Un fichier **par processus** : `<VARIA_RUN_DIR>/probe-<pid>.jsonl`, **append-only**, UTF-8, LF.
- Une ligne = un message = un objet JSON, **écrit et vidé** avant de continuer (le journal survit à
  une sortie brutale du processus : `process.exit`, `sys.exit`, `exit()`, `System.exit`).
- Une ligne tronquée (processus tué pendant l'écriture) est ignorée par l'orchestrateur et comptée
  (`PROBE_TRUNCATED`) ; une ligne JSON valide mais hors schéma est ignorée et comptée (`PROBE_INVALID`).
- Aucune valeur sensible brute n'est jamais écrite (§7).

## 4. Messages

### 4.1 Enveloppe (toutes les lignes)

| Champ             | Type                          | Règle                                                              |
| ----------------- | ----------------------------- | ------------------------------------------------------------------ |
| `protocolVersion` | entier                        | version **majeure** du protocole (`1`) — sur **chaque** ligne      |
| `runId`           | chaîne                        | copié de `VARIA_TARGETS`                                           |
| `type`            | chaîne                        | type du message (tableau ci-dessous)                               |
| `testId`          | chaîne `t_<16 hex>` ou `null` | test en cours (§8.1), `null` hors d'un test (chargement, `HELLO`)  |
| `timestamp`       | chaîne non vide               | ISO-8601, UTC conseillé ; affiché, **jamais** utilisé pour décider |

### 4.2 Types et champs propres

« ? » = optionnel (absent plutôt que `null`, sauf mention « ou `null` »). Les identifiants : §8.

| `type`                | Champs obligatoires                                                                                                       | Champs optionnels                                  | Quand                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| `HELLO`               | `mode` (`observe`\|`fuzz`), `pid` (entier ≥ 0), `mutationId` (chaîne ou `null`)                                           | `protocolMinor` (entier ≥ 0, absent ⇒ 0)           | sonde chargée dans un fichier/processus de test                           |
| `DISCOVER`            | `module`, `wrapped[]`, `unsupported[]`                                                                                    | —                                                  | exports d'un module cible enveloppés / non enveloppables                  |
| `TEST_START`          | `file` (relatif, POSIX), `name` (nom complet résolu)                                                                      | —                                                  | début d'un test                                                           |
| `TEST_END`            | —                                                                                                                         | —                                                  | fin d'un test                                                             |
| `OBSERVE_CALL`        | `callId` (≥ 1), `callSiteId` (ou `null` hors test), `module`, `export`, `depth`, `sequence`, `argsFingerprint`, `mutated` | `args[]` (valeurs étiquetées), `argsOmitted: true` | appel d'une target (après la décision de mutation)                        |
| `MUTATE_CALL`         | `callId`, `callSiteId`, `mutationId`, `applied`                                                                           | `reason`, `expectedFingerprint`, `argsFingerprint` | appel désigné par le plan : mutation appliquée ou refusée                 |
| `TARGET_RETURN`       | `callId`, `callSiteId` (ou `null`), `durationMs` (≥ 0), `async`, `value`                                                  | —                                                  | retour synchrone, ou promesse/future résolue (`async`)                    |
| `TARGET_THROW`        | `callId`, `callSiteId` (ou `null`), `durationMs`, `error`                                                                 | —                                                  | levée **synchrone**                                                       |
| `TARGET_REJECT`       | `callId`, `callSiteId` (ou `null`), `durationMs`, `error`                                                                 | —                                                  | rejet **asynchrone** du résultat rendu                                    |
| `PROBE_ERROR`         | `reason` (étape : `prepare`, `outcome`, `wrap`, `unhandled-rejection`…), `error`                                          | `module`, `export`, `callId`                       | erreur du code de la sonde (jamais propagée)                              |
| `UNHANDLED_REJECTION` | `callSiteId` (ou `null`), `chain[]` (callId englobants, du plus externe au plus interne), `error`                         | `callId`                                           | rejet que personne n'attend, attribué au contexte asynchrone qui l'a créé |

Précisions :

- `args` est présent pour les 20 premiers appels d'une même target à une même profondeur dans un test ;
  au-delà, `argsOmitted: true` (l'empreinte reste toujours présente).
- `MUTATE_CALL.reason` : `AMBIGUOUS_CALL_SITE` (empreinte différente de celle du plan : la mutation
  n'est **jamais** appliquée « au hasard » ; `expectedFingerprint` et `argsFingerprint` sont alors
  donnés) ou `PATH_NOT_FOUND` (chemin absent des arguments). La liste est ouverte (une mineure peut en
  ajouter).
- Un appel issu d'un autre appel de target (appel transitif) a `depth ≥ 1` ; la profondeur est suivie
  par un **contexte asynchrone** (AsyncLocalStorage en Node, `contextvars` en Python, contexte de
  fibre/thread en PHP/Java), jamais par un compteur global.
- Un même appel produit, dans l'ordre : `MUTATE_CALL`? puis `OBSERVE_CALL`, puis une issue
  (`TARGET_RETURN` | `TARGET_THROW` | `TARGET_REJECT`) — ou aucune issue si le processus meurt.

## 5. Valeurs étiquetées

Une valeur sérialisée est du JSON. Ce qui n'a pas d'équivalent JSON exact est un objet **étiqueté**
par la clé `$t`. Tout objet simple qui contient lui-même une clé `$t` ou `$redacted` est **échappé**
(`{"$t":"object","v":{…}}`) : aucune donnée ne peut se faire passer pour une étiquette.

| Valeur                        | Forme sérialisée                                                       | JS                        | Python                         | PHP                            | Java                                   |
| ----------------------------- | ---------------------------------------------------------------------- | ------------------------- | ------------------------------ | ------------------------------ | -------------------------------------- |
| absent                        | `{"$t":"undefined"}`                                                   | `undefined`               | argument omis (sentinelle)     | argument omis                  | — (non applicable)                     |
| nul                           | `null`                                                                 | `null`                    | `None`                         | `null`                         | `null`                                 |
| booléen, chaîne               | JSON natif                                                             | `boolean`, `string`       | `bool`, `str`                  | `bool`, `string`               | `Boolean`, `String`                    |
| nombre fini                   | nombre JSON                                                            | `number`                  | `int` (≤ 2^53−1), `float`      | `int`, `float`                 | `Integer`, `Long` (≤ 2^53−1), `Double` |
| `NaN`, `±Infinity`, `-0`      | `{"$t":"number","v":"NaN"\|"Infinity"\|"-Infinity"\|"-0"}`             | idem                      | `float('nan')`, `±inf`, `-0.0` | `NAN`, `±INF`, `-0.0`          | `Double.NaN`, `±Infinity`, `-0.0`      |
| grand entier                  | `{"$t":"bigint","v":"<décimal>"}`                                      | `bigint`                  | `int` hors ±(2^53−1)           | `GMP`, `int` hors ±(2^53−1)    | `BigInteger`, `Long` hors ±(2^53−1)    |
| instant                       | `{"$t":"date","v":"YYYY-MM-DDTHH:mm:ss.sssZ"}` (`v: null` si invalide) | `Date`                    | `datetime` (converti en UTC)   | `DateTimeInterface`            | `Instant`, `Date`                      |
| expression régulière          | `{"$t":"regexp","source":"…","flags":"…"}`                             | `RegExp`                  | `re.Pattern`                   | — (chaîne)                     | `Pattern`                              |
| table associative             | `{"$t":"map","entries":[[k,v],…]}`                                     | `Map`                     | `dict` à clés non toutes `str` | `SplObjectStorage`, `Ds\Map`   | `java.util.Map`                        |
| ensemble                      | `{"$t":"set","values":[…]}`                                            | `Set`                     | `set`, `frozenset`             | `Ds\Set`                       | `java.util.Set`                        |
| octets                        | `{"$t":"bytes","kind":"<type natif>","base64":"…"}`                    | `Buffer`, `Uint8Array`…   | `bytes`, `bytearray`           | — (chaîne binaire non UTF-8)   | `byte[]`, `ByteBuffer`                 |
| erreur (dans une valeur)      | `{"$t":"error","name":"…","message":"…"}`                              | `Error`                   | `BaseException`                | `Throwable`                    | `Throwable`                            |
| liste                         | tableau JSON                                                           | `Array`                   | `list`, `tuple`                | `array` liste                  | `List`, tableaux                       |
| objet simple                  | objet JSON (clés **propres**, dans l'ordre d'insertion)                | `{}` / prototype `null`   | `dict` à clés `str`            | `array` associatif, `stdClass` | — (voir instance)                      |
| instance d'une classe         | `{"$t":"object","ctor":"<classe>","v":{champs}}`                       | instance de classe        | objet (`__dict__`, dataclass)  | objet                          | POJO, `record`                         |
| fonction, flux, socket, natif | `{"$t":"opaque","kind":"function"\|"<classe>","name"?:"…"}`            | fonction, flux, `Promise` | fonction, générateur, fichier  | `Closure`, ressource           | lambda, `Stream`, `Socket`             |
| symbole (JS seul)             | `{"$t":"symbol","v":"<description>"}`                                  | `Symbol`                  | —                              | —                              | —                                      |
| trou de tableau (JS seul)     | `{"$t":"hole"}`                                                        | tableau creux             | —                              | —                              | —                                      |
| référence circulaire          | `{"$t":"circular"}`                                                    | idem                      | idem                           | idem                           | idem                                   |

**Plafonds** (DOIVENT être appliqués à l'identique, ils changent les empreintes) :

- profondeur 8 : au-delà, `{"$t":"truncated","type":"<type>"}` ;
- chaîne de plus de 4096 unités UTF-16 : `{"$t":"string","truncated":true,"length":n,"sha256":"<hex de la chaîne UTF-8>"}` ;
- plus de 200 éléments : tableau `{"$t":"array","truncated":true,"length":n,"items":[200 premiers]}` ;
  tables, ensembles et clés d'objets : les 200 premiers, sans marque.

Le type runtime d'une valeur (`string`, `number`, `bigint`, `boolean`, `null`, `undefined`, `array`,
`object`, `date`, `regexp`, `error`, `map`, `set`, `bytes`, `symbol`, `function`) est celui de la
forme sérialisée : son étiquette `$t`, ou le type JSON.

## 6. Sérialisation d'erreur

Une erreur levée ou rejetée (`TARGET_THROW`, `TARGET_REJECT`, `PROBE_ERROR`, `UNHANDLED_REJECTION`) :

| Champ              | Règle                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`             | nom de l'erreur (JS : propriété `name` ; ailleurs : nom court de la classe)                                                                               |
| `message`          | message, valeurs masquées retirées (§7)                                                                                                                   |
| `code`?            | propriété `code` convertie en chaîne si présente (JS `code`, Python `errno`/`code`, Java `getErrorCode()`)                                                |
| `status`?          | propriété `status` si elle est un **nombre fini** (sinon absente, jamais `null`)                                                                          |
| `stack`            | pile **filtrée** (lignes de la sonde, du runtime et du lanceur retirées, 15 cadres au plus), secrets retirés                                              |
| `constructorChain` | noms des classes de l'erreur, de la plus dérivée à la plus générale, **sans** la racine universelle (`Object`, `object`, `java.lang.Object`) ; 10 au plus |

Une valeur levée qui n'est pas un objet (JS `throw "x"`) : `name` = son type (`string`), `message` =
sa conversion en chaîne, `stack` vide, `constructorChain` vide. L'oracle ne fait **jamais** de
`instanceof` : il compare `constructorChain` aux noms configurés (`oracle.handled_errors`), ce qui
fonctionne entre royaumes (contexte vm de Jest) et entre langages. La sérialisation d'une erreur ne
lève jamais (getters hostiles ⇒ champs vides).

## 7. Redaction (dans la sonde, avant toute écriture)

Configuration : fichier `VARIA_REDACT` = `{ fields, patterns, skipPaths, hmacKey }`.

- Une **propriété d'objet** est masquée si son nom, en minuscules, est dans `fields` (comparés en
  minuscules), ou si l'un des `patterns` (expression régulière, **insensible à la casse**) trouve une
  correspondance dans son nom, ou si son chemin est dans `skipPaths`.
- Depuis **1.2**, la même règle (champs et motifs) s'applique à la **valeur** associée à une **clé
  textuelle de `Map`** (dictionnaire) : `Map { "password" => "…" }` est masquée comme `{ password }`
  (fixture `redaction/cle-de-map`). Une sonde 1.1 qui ne le fait pas écrit ce secret en clair.
- `skipPaths` : `"<export>#<chemin>"` ; pour un appel à l'export `createUser`, `createUser#arg0.password`
  masque `arg0.password` ; `login#arg1` masque l'argument entier. Chemins : `argN`, `.champ`, `[i]`.
- Valeur masquée : `{"$redacted":true,"fingerprint":"<hex>","type":"<type runtime de la valeur brute>"}`
  avec `fingerprint = HMAC-SHA256(hmacKey, JSON canonique (§10) de la sérialisation de la valeur brute)`
  (sérialisation faite sans `fields` ni `skipPaths`, avec les `patterns`).
- Toute **chaîne** masquée est retenue en mémoire le temps de l'appel et **retirée** (remplacée par
  `[REDACTED]`) du `message` et de la `stack` des erreurs de cet appel.
- Les chemins masqués ne sont jamais mutés. La valeur brute reste intacte en mémoire, dans le
  processus de test ; elle n'atteint jamais le disque (journaux, plan, base, rapports).
- L'empreinte d'arguments (§8.3) est calculée sur la forme **déjà redigée**.

## 8. Identités et empreintes

`sha256(x)` : hexadécimal minuscule du SHA-256 des octets UTF-8 de `x` ; `␀` : caractère U+0000.

1. **Test** : `testId = "t_" + sha256(file ␀ name ␀ rang)[0:16]`. `file` : chemin relatif à
   `projectRoot`, séparateur `/`. `name` : nom complet résolu (suites et titre, séparés par une espace,
   paramètres de `each` substitués). `rang` : nombre décimal, 0 pour la première occurrence de ce couple
   (fichier, nom) dans le processus, 1 pour la deuxième…
2. **Call site** : `callSiteId = "c_" + sha256(testId ␀ module ␀ export ␀ depth ␀ sequence)[0:16]`.
   `module` : chemin relatif du module cible ; `export` : nom de l'export (`default` pour un export
   par défaut) ; `sequence` : rang (0, 1, 2…) de l'appel **à cette target, à cette profondeur, dans ce
   test**. Hors d'un test, `callSiteId` vaut `null` et l'appel n'est jamais muté.
3. **Empreinte des arguments d'origine** : `argsFingerprint = sha256(JSON canonique de [args sérialisés et redigés])`.
   En mode `fuzz`, la sonde recalcule l'empreinte à l'appel désigné : égale à celle du plan ⇒ mutation
   appliquée ; différente ⇒ `MUTATE_CALL` `applied: false`, `reason: "AMBIGUOUS_CALL_SITE"`.

## 9. Le plan (lu par la sonde)

Le plan est un fichier JSON écrit par l'orchestrateur, **identique octet pour octet** pour une même
graine, une même configuration et un même commit : JSON canonique (§10) indenté de 2 espaces, LF final,
**aucun horodatage**, aucune empreinte de machine. Champs : `schemaVersion`, `variaVersion`, `seed`,
`gitCommit` (ou `null`), `configHash`, `possible`, `mutations[]`. La sonde n'utilise de chaque mutation
que : `id`, `callSiteId`, `argsFingerprint`, `path` (segments : `["arg0","user","name"]`), `op`
(`set` | `delete`) et `value` (valeur **étiquetée**, que la sonde reconstruit dans son langage).
La mutation s'applique à une **copie profonde** des arguments ; une clé est posée comme donnée
propre, jamais comme écriture de prototype (`__proto__` est une clé comme une autre).

## 10. JSON canonique

Base des empreintes et du plan. Obtenu en sérialisant la valeur JSON avec :

- clés d'objet triées : d'abord les clés « index » (entiers décimaux canoniques de 0 à 2^32−2, sans
  zéro de tête : `"0"`, `"9"`, `"10"`) par valeur numérique croissante, puis les autres clés par ordre
  des **unités de code UTF-16** (ordre de propriétés d'ECMAScript ; voir le cas
  `canonical/ordre-unicode`) ;
- nombres au format ECMAScript `Number.prototype.toString` (`1.0` ⇒ `1`, `1e21` ⇒ `1e+21`,
  `-0` ⇒ `0`) ; chaînes échappées comme `JSON.stringify` (`\"`, `\\`, `\n`, `\t`, `\b`, `\f`, `\r`,
  `\u00XX` pour les autres contrôles, tout le reste en UTF-8 brut) ;
- sans espace (empreintes) ; ou indentation de 2 espaces, `": "` après une clé, `[]`/`{}` pour les
  conteneurs vides (plan).

## 11. Versions et compatibilité

Version = **majeure.mineure** ; actuelle : **1.2** (1.1 : schémas, conformité, `protocolMinor` ; 1.2 : redaction des clés textuelles de `Map`).

- `protocolVersion` (entier, chaque ligne) porte la **majeure** ; `HELLO.protocolMinor` porte la
  **mineure** (absente ⇒ 0 : une sonde 1.0 reste valide). Choix compatible avec l'existant (un entier
  `1` sur chaque ligne depuis la version 1.0).
- **Mineure** (rétrocompatible) : ajout de champs **optionnels**, de types de messages, de valeurs dans
  une liste ouverte (`MUTATE_CALL.reason`, `PROBE_ERROR.reason`). Un lecteur plus ancien **ignore** les
  champs inconnus (retirés à la lecture) et les lignes d'un type inconnu (comptées à part, jamais
  invalides). Toute modification du jeu de conformité exige au moins une nouvelle mineure.
- **Majeure** : tout le reste (champ retiré ou renommé, type changé, sémantique changée, nouvelle
  étiquette `$t`, règle d'empreinte ou de redaction changée). Varia **refuse** une sonde d'une majeure
  qu'il ne connaît pas : erreur `UNSUPPORTED_PROBE`, code de sortie **5**, détail
  `PROBE_PROTOCOL_UNSUPPORTED: protocolVersion N (pris en charge : 1)` ; `varia doctor` rend le verdict
  `UNSUPPORTED_PROBE` avec la raison `PROBE_PROTOCOL_UNSUPPORTED`.
- **Invariant permanent** (toutes majeures) : le message `HELLO` porte l'enveloppe complète (§4.1) avec
  `protocolVersion` ; c'est ce qui permet de refuser clairement une sonde future.
- Une version publiée n'est jamais modifiée : la majeure courante est `PROTOCOL_VERSION`, la mineure
  `PROTOCOL_MINOR` (`packages/probe-protocol/src/messages.ts`), et `conformance/manifest.json` porte la
  version complète et l'empreinte du jeu.

## 12. Conformité d'une sonde

Une sonde est conforme à la version 1.2 si :

1. chaque ligne qu'elle écrit est valide contre `probe-message.schema.json` (et le schéma de son type) ;
2. elle rejoue avec succès tous les cas de `packages/probe-protocol/conformance/` (un cas portant sur un
   concept absent de son langage est déclaré non rejouable, jamais compté réussi) ;
3. elle respecte les règles non vérifiables par schéma : écriture vidée ligne à ligne, redaction avant
   écriture, au plus une mutation sur une copie, profondeur par contexte asynchrone, défense (§1).

## 13. Sondes fournies et rejeu de la conformité

Chaque sonde rejoue les 65 cas du jeu (`conformance/cases/*.json`, version et empreinte dans
`manifest.json` ; décompte : somme des tableaux `cases` des 7 fichiers). Un cas non rejouable est listé
**nommément** avec sa raison, et le test vérifie que la liste n'a ni plus ni moins d'éléments que
prévu : il n'est jamais compté réussi.

| Sonde                 | Où                                                                  | Rejeu (lancé par `npm test`)                                                                                                                                              | Non rejouables (source)                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript (réf.)     | `packages/probe-runtime/runtime/`                                   | `packages/probe-runtime/test/conformance.test.ts`                                                                                                                         | aucun                                                                                                                                                                                                                                 |
| Lanceur custom (fac.) | `examples/custom-project/runner.cjs`                                | `packages/adapters/custom/test/protocol.test.ts`                                                                                                                          | aucun                                                                                                                                                                                                                                 |
| Python (pytest)       | `packages/adapters/pytest/runtime/varia_probe/`                     | `test/python/test_conformance.py`, lancé par `packages/adapters/pytest/test/python.test.ts` (interpréteur de `examples/pytest-project`, coverage.py 100 %)                | **1** : `values/set` (ensemble sans ordre d'insertion ; xfail strict) — `NOT_REPLAYABLE` de `test_conformance.py`                                                                                                                     |
| PHP (PHPUnit)         | `packages/adapters/phpunit/runtime/src/`                            | `runtime/tests/ConformanceTest.php`, lancé par `packages/adapters/phpunit/test/runtime.test.ts` (PHPUnit de l'exemple, pcov 100 % des lignes)                             | **6** : `values/bigint`, `values/map`, `values/set`, `values/bytes-vide`, `objects/circulaire-tableau`, `redaction/cle-de-map` — `NOT_APPLICABLE` de `ConformanceTest.php`                                                            |
| Java (JUnit)          | `packages/adapters/junit/agent/src/main/java/com/orqea/varia/probe` | `agent/src/test/java/…/ConformanceTest.java`, lancé par `mvn -o verify` depuis `packages/adapters/junit/test/agent.test.ts` (60 réussies, 5 non rejouables, JaCoCo 100 %) | **5** : `values/undefined`, `values/set`, `values/tableau`, `fingerprint/etiquetees` (pas de valeur absente distincte de `null`), `redaction/cle-de-map` (Map à clés textuelles = objet) — `NOT_REPLAYABLE` de `ConformanceTest.java` |

Outils requis (à installer soi-même) : Python 3.11, PHP 8.3 + pcov + composer, Java 21 + Maven ;
`npm run examples:install` crée ensuite le venv de l'exemple pytest, fait `composer install` des
exemples PHP, construit l'agent Java (`mvn verify`) et résout les dépendances Maven.
