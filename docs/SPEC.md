
# VARIA — Cahier des charges, révision 7

> *Your tests prove that your software works. Varia tests what happens when it doesn't get what it expects.*

**Statut :** document de référence. Remplace la révision 5. **Destiné à être exécuté par un agent de développement autonome** (Claude Code cloud) dans un dépôt vide : les parties A à D ci-dessous sont normatives et prioritaires sur le reste en cas de conflit.

---

## PARTIE A — Brief d'exécution pour l'agent autonome

### A.1 Mission
Construire Varia dans un **nouveau dépôt vide** (`varia/`), jalon par jalon (J0 → J1 → …), en commençant **obligatoirement** par J0. Le propriétaire n'est pas disponible en cours de route : l'agent décide seul selon les règles ci-dessous, documente ses décisions, et ne s'arrête que dans les cas listés en A.4.

### A.2 Règles de travail
1. **Un jalon à la fois.** Ne jamais commencer J(n+1) tant que les tests d'acceptation de J(n) (partie C) ne passent pas **et** que le rapport de jalon (A.5) est écrit.
2. **Branches et commits.** Branche par jalon (`milestone/j0-spike`, …). Commit à **chaque étape vérifiée** (tests verts), jamais de gros commit final unique. Message : `jN: <étape>`. Ne jamais commiter sur la branche principale directement sans que le jalon soit accepté ; fusion dans la principale à l'acceptation.
3. **Test d'abord pour tout comportement spécifié** : la partie C est la spécification exécutable ; chaque critère devient un test automatisé avant l'implémentation.
4. **Aucune triche de mesure.** Interdit : désactiver/sauter un test, baisser un seuil, simuler un support (`UNSUPPORTED` ou `OPAQUE` à la place), écrire un test qui ne peut pas échouer. Un test doit être vu **échouer** au moins une fois (sur le code ou par mutation manuelle du code testé) avant d'être cru.
5. **Vérifier avant de déclarer.** Le rapport ne contient que ce qui a été exécuté et observé. Toute affirmation porte sa commande de reproduction.
6. **Pas de réseau à l'exécution de Varia.** Le cœur n'émet aucune requête sortante. Accès réseau autorisés **au développement uniquement** : installation des dépendances, et récupération d'un projet open source de test pour J1 (A.7).
7. **Windows, macOS, Linux.** Le code est écrit portable (chemins via `node:path`, tuerie d'arbre de processus par implémentation par plateforme). L'agent ne peut **vérifier que sa propre plateforme** : tout ce qui concerne une autre plateforme (arbre de processus Windows, CI multi-OS, chemins Windows) est écrit, testé par des tests unitaires de l'implémentation quand c'est possible, et marqué **`UNVERIFIED (plateforme)`** dans le rapport — jamais « OK ». La CI multi-OS est ajoutée dès J1 en workflow versionné ; son premier résultat réel est une **tâche du propriétaire**, listée dans le rapport.
8. **Aucune modification durable du projet cible.** Vérifiée par la procédure du §5 dans les tests.
9. **Sécurité des secrets :** aucune clé, aucun jeton dans le dépôt ni dans les journaux.
10. **Reprise après interruption.** L'agent écrit `STATE.md` (dernier jalon, étape faite, étape en cours, commandes de vérification) à chaque commit ; au démarrage d'une session il relit `STATE.md`, relance la suite de tests **avant** de croire un état rouge ou vert, puis continue.

### A.3 Règles de décision autonome
- **Ambiguïté technique :** choisir l'option la plus simple qui préserve l'extensibilité, l'écrire dans `DECISIONS.md` (contexte, options, choix, raison, date), continuer.
- **Choix déjà tranchés :** voir partie B ; ne pas les rouvrir.
- **Dépendance manquante ou incompatible :** essayer l'alternative prévue en partie B ; sinon documenter et choisir la plus proche.
- **Un test échoue :** corriger le code ; ne jamais adapter le test pour qu'il passe sans justification écrite dans `DECISIONS.md`.
- **Une fonctionnalité du CDC est irréalisable telle quelle :** la marquer `NOT FEASIBLE` dans le rapport avec preuve (commande + sortie), implémenter la variante dégradée la plus honnête (jamais une fausse), continuer.

### A.4 Cas d'arrêt (les seuls)
1. J0 : **toutes** les stratégies d'injection de la partie D échouent aux critères de J0 ⇒ écrire le rapport `NO-GO` (preuves, ce qui a été essayé, hypothèses restantes) et **s'arrêter**.
2. Une action nécessiterait un accès extérieur non prévu (compte, secret, paiement, publication publique).
3. Contradiction irréconciliable entre deux exigences normatives (la documenter précisément).
4. Dépassement de budget : plus de 3 tentatives de correction du même problème sans progrès ⇒ consigner et passer à la variante dégradée, ou s'arrêter si elle n'existe pas.

### A.5 Rapport de fin de jalon (obligatoire)
Fichier `reports/jN.md` : **FAIT / PAS FAIT / NON SUPPORTÉ / LIMITATIONS / TESTS EXÉCUTÉS (commande + résultat) / MESURES / DÉCISIONS PRISES / RISQUES / PROCHAINE ÉTAPE**. Pour J0 : verdict `GO` ou `NO-GO` et stratégie d'injection retenue.

### A.7 Projet de test réel pour J1 (l'agent n'en possède pas)
Pour l'acceptation de J1 (§45), l'agent **choisit lui-même** un projet open source public remplissant **tous** ces critères : licence permissive (MIT/BSD/Apache-2.0) ; suite **Jest** ; code CommonJS ou TypeScript transpilé par ts-jest/babel (pas d'ESM natif) ; moins de 300 tests ; baseline verte hors dépendances réseau/base. Il le récupère par un script `scripts/fetch-external.mjs` à **commit épinglé** (hash complet), dans `examples/external/` (**ignoré par git**, jamais committé), consigne le choix et ses raisons dans `DECISIONS.md`. Si aucun projet ne satisfait les critères après 3 essais documentés : J1 est accepté sur l'exemple seul et le rapport l'indique `EXTERNAL_PROJECT: NOT VALIDATED`.

### A.8 Gestion du budget et du temps
Pas de limite de durée fixe, mais : (a) **tout** travail inachevé est committé avant de s'arrêter, avec `STATE.md` à jour ; (b) si le contexte/budget de la session approche de sa fin, l'agent finit l'étape en cours, committe, écrit `STATE.md` et un rapport partiel ; (c) un jalon n'est jamais déclaré accepté sur un rapport partiel.

### A.6 Fichiers à créer dès le premier commit
`README.md` (but, installation, état), `CLAUDE.md` (principes §2, règles A.2–A.4, commandes de test/lint/build), `DECISIONS.md`, `STATE.md`, `.nvmrc` (Node 20), `LICENSE` (voir B), `.gitignore`, `package.json` (workspaces), `tsconfig.base.json` (strict), CI de base.

---

## PARTIE B — Décisions déjà prises (ne pas rouvrir)

| Sujet | Décision |
|-------|----------|
| Langage / runtime | TypeScript strict, Node.js 20 LTS minimum |
| Gestionnaire | npm workspaces |
| Tests de Varia | Vitest |
| Base | SQLite via `better-sqlite3` (binaires précompilés) ; repli `node:sqlite` si Node ≥ 22.5 ; ORM Drizzle ; si le module natif ne s'installe pas sur la plateforme, passer sur `node:sqlite` et le documenter |
| CLI | Commander |
| Validation | Zod (+ JSON Schema généré) |
| Journalisation | pino (JSON) |
| Stockage par défaut | Répertoire de données utilisateur hors du projet cible (§4.3) |
| Mode `auto` | Enveloppe **tous** les exports fonctions des modules `include` ; la liste des targets réellement appelées vient de l'**observation en baseline**, pas d'un outil de couverture (§11) |
| Async | Rejet non attendu ⇒ `CRASH` dès J1 |
| Méthodes de classes | Ciblables si la classe est exportée ; l'instance construite par le test est conservée, seuls les arguments sont mutés |
| Gravité configurable | Non avant J3 |
| Licence | MIT par défaut, **sauf instruction contraire du propriétaire** (décision du propriétaire, à confirmer ; ne bloque rien) |
| Nom du binaire | `varia` (conflit éventuel de nom de paquet npm : sans importance, Varia n'est pas publié en J0–J2) |
| Formats de sortie | JSON versionné (`schemaVersion`) |
| Fuseau/horloge | Horodatages UTC ISO-8601 |
| Fin de ligne | LF partout (`.gitattributes`) |
| Aléa | Générateur **mulberry32** (implémenté dans Varia, 32 bits) alimenté par la graine ; interdit : `Math.random` dans le moteur de mutation. Empreintes : SHA-256 en hexadécimal |
| Plan | Ne contient **aucun** horodatage ni identifiant d'exécution ; JSON sérialisé avec clés triées et indentation fixe, pour que « identique octet à octet » ait un sens |
| Code de spike | Le code de `spike/` peut être réutilisé en J1 s'il passe la revue de l'agent (tests + typage strict) ; sinon réécrit. `spike/` est supprimé à la fin de J1 |

---

## PARTIE C — Spécification exécutable de J0 (critères d'acceptation)

### C.0 Projet d'exemple normatif (`examples/jest-project/`, CommonJS, JavaScript d'abord)
L'agent le crée **exactement** avec ces comportements (les scénarios en dépendent). Fichiers sous `src/`, tests sous `tests/`, aucune dépendance runtime.

| Fonction (export) | Comportement exigé | Sert à |
|-------------------|--------------------|--------|
| `createUser({ name, age, password })` | Lève `ValidationError` (classe maison) si `name` est `null`, `undefined`, ou chaîne vide après `trim` ; fait `name.trim()` **sans** vérifier le type quand `name` n'est ni `null` ni chaîne (⇒ `TypeError` pour `{}`, `[]`, `123`) ; retourne `{ id, name: name.trim(), age }` sans jamais retourner `password` | J0-3/4/5/6/11 |
| `echoValue(x)` | Retourne `{ received: x }` sans rien vérifier | J0-18 (ECHO ; pour `null` : pas d'ECHO) |
| `repeat(label, count)` | Boucle `let n = count; while (n !== 0) { n--; }` : termine pour un entier ≥ 0 ; **ne termine jamais** pour `NaN`, un décimal (`1.5`), un négatif, `null`, `undefined` (⇒ `NaN`), `{}`/`[]` (⇒ `NaN`). Note : `"3"` **termine** (la coercition numérique l'amène à 0), ce qui en fait un cas `PASSED` utile | J0-8 (TIMEOUT) |
| `exitOn(flag)` | Appelle `process.exit(1)` si `flag === "boom"`, sinon retourne `flag` | J0-9 |
| `stamp(label)` | Retourne `label` + `":" + Date.now()` ; le test l'utilise comme argument d'`echoValue` pour produire des arguments **non déterministes** | J0-13 |
| `fetchUser(id)` (`async`) | Rejette (`Promise.reject(new ValidationError(...))`) si `id` n'est pas un entier positif ; lève **synchroniquement** `TypeError` si `id` est un objet ; résout sinon | J0-14 |
| `outer(x)` (`async`) | Fait `await` d'une temporisation d'un tick, puis appelle `inner(x)` via l'export d'un autre module ; `inner` (synchrone) fait `x.length` | J0-16 (depth 0 et 1, appels entrelacés) |
| `sumLocal(a, b)` | Appelle `helper(a)` **dans le même fichier**, sans passer par `exports` | J0-17 |

Dans l'exemple, la configuration de Varia fixe `execution.timeout_ms: 3000` (les mutations de `repeat` coûtent un timeout chacune : le plan de J0 les **limite** à 3 mutations sur `repeat`).
Tests : un test `createUser` valide ; un test qui appelle `createUser` trois fois (J0-12) ; un `test.each` à trois cas sur `createUser` (J0-15) ; un test `async` pour `fetchUser` avec appels `await` entrelacés dans `Promise.all` pour `outer` (J0-16) ; un test de `stamp`/`echoValue` (J0-13) ; un test `repeat("a", 3)` et un `exitOn("ok")`.

### C.1 Scénarios d'acceptation
Tous doivent passer pour le verdict `GO`.

| ID | Étant donné | Quand | Alors |
|----|-------------|-------|-------|
| J0-1 | L'exemple et ses tests Jest | `baseline` | 100 % des tests passent ; les appels à `createUser` sont observés avec leurs arguments |
| J0-2 | Baseline observée deux fois | `stability` | Aucune différence de call sites ni d'empreinte d'arguments ; si différence ⇒ `FLAKY` |
| J0-3 | `createUser({name: "Erwann"})` | mutation `name = null` | Résultat `HANDLED` (la cible lève `ValidationError`) |
| J0-4 | idem | mutation `name = {}` | Résultat `CRASH` (la cible lève `TypeError`) |
| J0-5 | idem | mutation `name = ""` | Résultat conforme à la fonction (documenté dans l'exemple) |
| J0-6 | Le test muté échoue à ses assertions | classification | Le statut du test **n'influence pas** le résultat HANDLED/CRASH |
| J0-7 | Même graine, deux runs | génération du plan | Plans **identiques octet à octet** |
| J0-8 | Une mutation qui boucle indéfiniment (cible d'exemple `hang`) | exécution avec timeout | `TIMEOUT`, l'arbre de processus est tué, la mutation suivante s'exécute |
| J0-9 | Une mutation qui fait `process.exit(1)` | exécution | `CRASH` (sortie anormale), la suivante s'exécute |
| J0-10 | Arbre git du projet exemple | avant/après run | **Identique** (procédure §5) ; aucun fichier créé dans le projet |
| J0-11 | Valeur sensible (`password`) dans les arguments | observation | Aucune valeur brute dans les journaux JSONL sur disque (grep prouvé) |
| J0-12 | Même target appelée 3 fois dans un test | mutation sur le 2ᵉ appel | Seul le 2ᵉ appel est muté ; les autres restent à l'identique |
| J0-13 | Empreinte d'arguments différente entre baseline et fuzz (test non déterministe forcé) | application | `SKIPPED / AMBIGUOUS_CALL_SITE`, jamais appliquée |
| J0-14 | Target `async` | mutation | Rejet de promesse distingué d'un retour résolu et d'une levée synchrone |
| J0-15 | `test.each` à 3 cas | observation + mutation | Trois tests distincts avec `testId` stables entre deux runs |
| J0-16 | Target qui en appelle une autre (profondeur 1) | observation | `depth` correct (0 et 1) même avec appels `async` entrelacés |
| J0-17 | Appel direct entre deux fonctions du même module | observation | Non observé ; apparaît comme limite dans le rapport |
| J0-18 | Fonction qui renvoie telle quelle une valeur d'un autre type | mutation `type` | `SUSPICIOUS_ACCEPT` avec raison `ECHO` ; pour `null` renvoyé tel quel : **pas** d'`ECHO` |
| J0-19 | Les mêmes scénarios sous TypeScript (ts-jest ou babel) | exploration | Marche / partiel / ne marche pas, avec cause |
| J0-20 | Scénarios sous ESM natif et avec `jest.resetModules` / `jest.mock` | exploration | idem |

**Mesures obligatoires à consigner (`reports/j0.md`) :** coût de démarrage d'un processus Jest sur l'exemple ; surcoût de la sonde en baseline (`probe_overhead_pct`) ; durée moyenne d'une mutation isolée ; estimation pour 1 000 mutations.

**Seuil de GO :** J0-1 à J0-18 verts avec **une** stratégie d'injection de la partie D, et mesures consignées. J0-19 et J0-20 n'ont pas de seuil : ils définissent le périmètre de J1.

---

## PARTIE D — Stratégies d'injection (ordre d'essai et règle de repli)

L'agent essaie les stratégies **dans cet ordre** et retient la **première** qui satisfait J0-1 à J0-18. Il consigne pour chacune essayée : résultat, causes d'échec, mesures.

| # | Stratégie | Principe | Limite connue |
|---|-----------|----------|---------------|
| D1 | **Transform temporaire** (§10.0) | Un transform Jest, placé dans une configuration générée hors du projet, délègue au transform d'origine puis ajoute `__varia.wrapExports(module.exports, id)` aux modules `include` | Délégation au transform du projet (ts-jest, babel) à vérifier ; cache de transformation à isoler |
| D2 | **`jest.mock` généré** | Un fichier `setupFilesAfterEach` généré, hors du projet, appelle pour chaque module `declared` : `jest.mock(chemin, () => wrap(jest.requireActual(chemin)))` | Nécessite des cibles `declared` ou une liste produite par un scan préalable des exports ; interagit avec les mocks du projet |
| D3 | **Copie de travail instrumentée** | Copie temporaire du projet (hors du dépôt cible) dans laquelle les modules `include` sont réécrits par AST (TypeScript Compiler API) pour envelopper leurs exports | Plus lent à préparer ; chemins/`__dirname` à gérer ; source maps à conserver |
| D4 | **Hook de chargement Node** (`--require` / `Module._load`) | Enveloppement au niveau du chargeur Node | **Inopérant sous Jest** (Jest a son propre système de modules) ; ne vaut que pour un runner s'exécutant sur le chargeur natif de Node — essayé seulement pour documenter la limite |

**Règle de repli :** D1 → D2 → D3. D4 n'est jamais un repli pour Jest. Si D1 réussit, J1 s'appuie sur D1 et le rapport conserve D2/D3 comme replis documentés. Si **aucune** ne réussit J0-1 à J0-18 : verdict `NO-GO` (A.4-1).

### D.0 Contrat de la sonde (identique pour D1, D2, D3)
Variables d'environnement lues par la sonde dans le processus de test (jamais de réseau) :

| Variable | Rôle |
|----------|------|
| `VARIA_MODE` | `observe` ou `fuzz` |
| `VARIA_RUN_DIR` | Répertoire du run où écrire les journaux JSONL |
| `VARIA_PLAN` | Chemin du plan (mode `fuzz`) |
| `VARIA_MUTATION_ID` | Identifiant de la mutation à appliquer (mode `fuzz`) |
| `VARIA_TARGETS` | Chemin du fichier listant les modules/exports à envelopper |
| `VARIA_REDACT` | Chemin du fichier des règles de redaction |

Sérialisation d'une erreur par la sonde : `{ name, message, code?, status?, stack (filtrée), constructorChain: ["TypeError","Error"] }`. La **chaîne des noms de constructeurs** remplace tout `instanceof` côté oracle : Jest exécute les tests dans un contexte `vm` où `instanceof` ne traverse pas les contextes, et l'oracle (hors sandbox) ne doit jamais s'y fier.

**Contrainte commune à toutes les stratégies :** l'état de la sonde vit sur `globalThis.__varia` ; la profondeur d'appel utilise `AsyncLocalStorage` ; la redaction s'applique avant toute écriture ; une valeur d'argument n'est jamais modifiée en place (copie profonde).

---

## PARTIE E — Reste du cahier des charges (spécification du produit)

Les sections ci-après (0.0 et suivantes) décrivent le produit cible. Les parties A à D priment en cas de conflit. Les tableaux d'historique (§0.0, §0) sont informatifs.

---
**Nature :** projet indépendant, dépôt séparé du projet testé.
**Convention de nommage :** ce document est une **révision** (rev 5). Les étapes de construction du produit sont des **jalons** (J0, J1, …). Les deux numérotations ne se mélangent jamais.

---

## 0.00 Changements des révisions 6 et 7
- **Rév 6 :** passage à une spécification **exécutable par un agent autonome** (parties A à D) ; décisions déjà prises (B) ; scénarios J0 mesurables (C) ; stratégies d'injection avec ordre de repli (D) ; mode `auto` sans outil de couverture ; prompt de lancement unique.
- **Rév 7 :** projet d'exemple normatif (C.0) ; contrat de sonde par variables d'environnement et sérialisation d'erreur par chaîne de constructeurs, sans `instanceof` (D.0) ; ce qui est invérifiable par l'agent (autre plateforme, CI multi-OS) est `UNVERIFIED`, jamais « OK » (A.2-7) ; projet externe de test choisi par l'agent selon critères (A.7) ; budget et reprise (A.8) ; aléa et plan déterministes spécifiés (B) ; acceptation J1 vérifiable, avec preuve que les tests peuvent échouer.

## 0.0 Changements de la révision 5 (issus de la revue critique de la rév 4)

| # | Défaut de la rév 4 | Correction rév 5 |
|---|--------------------|------------------|
| S1 | **Le mécanisme d'enveloppement des targets n'était pas écrit** : la partie la plus risquée du produit restait implicite | §10.0 : transformation de modules ciblés, avec ses limites assumées |
| S2 | **Appels transitifs ignorés** : une target appelée par une autre target était mutée comme si le test l'appelait | §10.11 : notion de profondeur d'appel, `targets.depth` (défaut `direct`) |
| S3 | **Règle `SUSPICIOUS_ACCEPT` floue** (« dépend de ») et donc source de faux positifs non testables | §18.4 : deux déclencheurs précis, vérifiables, avec raison enregistrée |
| S4 | **Fuite de secrets sur disque** : la sonde écrivait les valeurs brutes dans des journaux temporaires avant la redaction | §10.6 / §32 : redaction **dans la sonde**, journaux purgés après ingestion |
| S5 | **Coût d'un processus par mutation** non chiffré (1 420 mutations × démarrage Jest = plus d'une heure) | §35 : estimation de durée dans `varia plan`, optimisation par lot précisée comme chantier J3 |
| S6 | Vérification « projet inchangé » non définie hors git | §5 : procédure précise avec et sans git |
| S7 | Cache de transformation du runner non isolé | §33.3 : cache dédié par run |
| S8 | `acceptances` était à la fois une liste et un objet dans la config | §21 : `acceptances: { store, items }` |
| S9 | Matrice de compatibilité ambiguë sur ce que J1 supporte | §34 : cases étiquetées par jalon |
| S10 | Critère d'acceptation J1 « projet réel » irréaliste si le projet est en ESM | §45 : J1 = CJS + TypeScript transpilé ; ESM = J2 |

---

## 0. Origine de la révision 4

La révision 4 consolide la v0.2 (périmètre fonctionnel) et la rév 3 (rigueur, honnêteté, capabilities) et corrige leurs défauts.

| # | Défaut constaté | Correction rév 4 |
|---|-----------------|------------------|
| R1 | Acceptation silencieuse invisible depuis le retrait de `semantic` | Règle `SUSPICIOUS_ACCEPT` indépendante de la sémantique métier (§18.4) |
| R2 | `boundary` inapplicable sans limites connues | Restauration de `inputs.hints` et de l'inférence de bornes par observation (§12.3) |
| R3 | Numérotation document/produit confondue | Révisions vs jalons |
| R4 | Stockage `.varia/` dans le projet = modification du projet | Stockage utilisateur externe par défaut (§4.3) |
| R5 | Transport sonde ↔ Varia non défini ; deux écritrices potentielles de la base | **Une seule écrivaine de la base : l'orchestrateur.** La sonde écrit des journaux JSONL (§10.6) |
| R6 | Identité de call site fragile entre exécutions | Séquence + empreinte des arguments d'origine, vérifiée à l'application (§10.4) |
| R7 | Détail de config, resets, DB, `oracle suggest`, origine d'erreur perdus | Restaurés (§5, §13, §24, §18) |
| R8 | Spike surchargé | Spike en deux temps : critère obligatoire puis exploration notée (§45) |
| R9 | Aucun modèle d'async, de `test.each`, d'identité de test | Définis (§10.8, §10.9) |
| R10 | Cas d'écriture concurrente sur le projet (artefacts de Jest, caches, snapshots) | Section effets de bord du runner (§33.3) |

---

## 1. Présentation

### 1.1 Concept
Varia est une application **locale** de test de résilience par perturbation de données. Elle se place **au-dessus** d'un projet existant et de ses tests : elle exécute les tests tels quels, **observe les appels réels** faits au code testé, puis rejoue chaque test en **modifiant une valeur d'entrée** à la fois, et **classe le comportement du code testé**.

```text
workspace/
├── my-application/        projet cible (src, tests, package.json, varia.yml)
└── varia/                 dépôt Varia, cloné séparément
```

### 1.2 Question à laquelle Varia répond
> « Mes tests passent avec leurs données habituelles. Que se passe-t-il si une valeur inattendue arrive réellement à une fonction testée ? »

Exemple : le test appelle `createUser({ name: "Erwann", age: 25 })`. Varia observe `arg0.name` et `arg0.age`, puis crée des variantes **séparées** (`name = null`, `name = ""`, `name = {}`, `age = "25"`, `age = -1`…), et note si la fonction refuse proprement, accepte sans broncher, ou s'effondre.

### 1.3 Ce que Varia n'est pas
Pas un SaaS ; pas une dépendance à ajouter au projet testé ; pas un remplaçant de Jest/Vitest ; pas un outil de mutation du **code** (Stryker/PIT) ; pas un scanner réseau ni un outil offensif ; pas une IA obligatoire ; pas une garantie que l'application est « robuste ».

### 1.4 Positionnement
| Outil | Différence |
|-------|-----------|
| fast-check / Hypothesis | Le développeur écrit des générateurs ; Varia réutilise les appels des tests existants |
| Stryker / PIT | Mute le code ; Varia mute les données (complémentaires) |
| Jazzer.js / AFL / libFuzzer | Fuzz guidé par la couverture sur une cible ; Varia part des tests, classe le comportement, garde l'historique |
| Schemathesis / RESTler | Fuzz HTTP depuis un schéma ; Varia agit au niveau fonction |

---

## 2. Principes directeurs

1. **Externe** — Varia reste dans son propre dépôt.
2. **Observer avant de muter** — pas de mutation sans baseline valide et stable.
3. **Une mutation = un cas identifiable, rejouable.**
4. **Le comportement de la cible prime sur le statut du test.**
5. **Déterminisme** — même projet, commit, config, graine et version ⇒ même plan.
6. **Isolation** — une mutation ne contamine pas la suivante.
7. **Séquentiel par défaut** — la fiabilité passe avant la vitesse.
8. **Honnêteté** — Varia dit ce qu'il n'a pas observé, pas muté, pas pu rejouer.
9. **Pas de décision probabiliste** — aucun mécanisme opaque ne déclare une erreur acceptable.
10. **Issues avant scores.**
11. **Capabilities explicites** — un adapter déclare ce qu'il sait réellement faire.
12. **Aucune modification durable** du projet cible.
13. **Local par défaut**, aucune télémétrie.
14. **Une seule écrivaine de la base** — l'orchestrateur (§10.6).
15. **La sonde observe, le cœur juge** (§41).
16. **Extensibilité après stabilisation.**
17. **Une fonctionnalité non testable n'est pas terminée.**

---

## 3. Glossaire

| Terme | Définition |
|-------|------------|
| Projet cible | Application sur laquelle Varia s'exécute |
| Baseline | Exécution normale des tests, sans mutation |
| Sonde (probe) | Code éphémère dans le processus de test, enveloppe les targets |
| Target | Fonction/export dont les appels sont observables |
| Call site | Un appel observé d'une target dans un test, identifié par (test, target, séquence) |
| Input / chemin | Valeur reçue par une target / son adresse (`arg0.user.email`) |
| Mutation | Remplacement d'une valeur (un chemin) par une variante |
| Plan | Liste sérialisée et ordonnée de mutations |
| Oracle | Règles de classification du comportement |
| Issue | Groupe de mutations de même cause racine |
| Run | Exécution de Varia (complète ou partielle) |
| Capability | Fonction réellement supportée par un adapter |
| Opaque / Unsupported | Valeur non inspectable / fonction non supportée |
| Jalon | Étape de construction du produit (J0, J1…) |

---

## 4. Installation, indépendance, stockage

### 4.1 Installation
```bash
git clone <varia-repository> ../varia
cd ../varia && npm install && npm run build
cd ../my-application && ../varia/bin/varia test
```
Aucun paquet Varia n'est ajouté au `package.json` du projet cible.

### 4.2 Configuration
Fichier `varia.yml`, `varia.yaml` ou `varia.json` dans le projet cible (un seul). Schéma JSON publié pour l'autocomplétion. `varia config --check` valide ; `varia config --print` affiche la configuration résolue (secrets masqués).

### 4.3 Stockage (corrigé)
Par défaut, les données vivent **hors du projet cible**, dans le répertoire de données utilisateur standard de la plateforme :

```text
<user-data>/varia/projects/<nom>-<empreinte-du-chemin>/
├── varia.db
├── plans/
├── artifacts/
└── reports/
```

- Le projet cible ne reçoit **aucun** nouveau dossier ni modification de `.gitignore`.
- `storage.path` permet de choisir ailleurs ; `--data-dir` l'impose en ligne de commande (**CI** : monter ce répertoire en cache entre jobs).
- Option `storage.location: project` : dossier `.varia/` dans le projet ; Varia l'ajoute alors à `.git/info/exclude` (jamais à `.gitignore`).
- Les fichiers temporaires d'un run (sonde, plans, journaux JSONL) vivent dans un sous-dossier `tmp/` du stockage, jamais dans le projet.
- Chaque projet a sa propre base. Aucune donnée n'est partagée entre projets.

---

## 5. Politique de modification du projet cible

Varia ne modifie jamais durablement le code source, les tests, `package.json` ni la configuration existante. Il injecte la sonde de façon **éphémère**, par ordre de préférence :

1. option/mécanisme officiel du runner (ex. fichier de setup passé en ligne de commande) ;
2. configuration temporaire du runner, **écrite hors du projet** (dans `tmp/`) et référencée ;
3. variable d'environnement (`NODE_OPTIONS=--require/--import`) ;
4. hook de chargement de modules ;
5. copie de travail temporaire (répertoire ou worktree git).

Si aucune méthode fiable n'existe : `UNSUPPORTED_PROBE` (exit 5), avec explication. Varia ne force pas une instrumentation douteuse.

**Vérification (procédure) :** avant et après chaque run, Varia capture l'état du projet.
- **Avec git :** sortie de `git status --porcelain=v1 -z` (fichiers suivis modifiés et non suivis non ignorés) **plus** l'empreinte du contenu de chaque fichier listé.
- **Sans git :** manifeste (chemin, taille, date de modification, empreinte du contenu au-delà de 1 Mo en mode échantillonné) de tous les fichiers hors `node_modules`, hors répertoires déclarés en `ignore_for_integrity` (ex. `coverage/`, `dist/`).
- Les fichiers **ignorés par git** ne sont pas surveillés par défaut (les runners y écrivent souvent des caches) ; `integrity.watch_ignored: true` les inclut.
- Toute différence **attribuable au run** ⇒ `PROJECT_MUTATED` (erreur grave, exit 4, liste des fichiers). Une différence déjà présente **avant** le run est signalée en avertissement mais ne bloque pas.
- `varia clean` supprime les résidus connus de Varia.

---

## 6. Architecture

```text
┌──────────────────────────────┐
│        PROJET CIBLE          │
│ src/ tests/ varia.yml        │
└──────────────┬───────────────┘
               │ runner + sonde éphémère
               ▼
┌────────────────────────────────────────────────────┐
│                      VARIA                         │
│ CLI → Orchestrateur ──┬─ Config                    │
│                       ├─ Adapter ── Probe Manager  │
│                       ├─ Baseline / Stabilité      │
│                       ├─ Input Catalog             │
│                       ├─ Mutation Planner          │
│                       ├─ Execution Engine          │
│                       ├─ Normalizer → Oracle       │
│                       ├─ Analyzer (issues, diff)   │
│                       └─ DB (écrivaine unique)     │
│                              │                     │
│              Reporters   API locale (lecture) ─ Dashboard
└────────────────────────────────────────────────────┘
```

**Règle d'architecture :** le cœur ne connaît aucun runner. Aucun import de `jest`, `vitest`, etc. hors `packages/adapters/*`. Un test d'architecture en CI le vérifie, ainsi que l'absence de cycles entre paquets.

---

## 7. Phases d'un run

```text
1 CONFIG  2 DOCTOR  3 BASELINE  4 STABILITÉ  5 OBSERVATION  6 CATALOGUE
7 PLAN    8 EXÉCUTION  9 ORACLE  10 REGROUPEMENT  11 COMPARAISON
12 PERSISTANCE  13 RAPPORT
```

Chaque phase a : état, durée, événements, erreurs, artefacts. États d'un run : `CREATED → … → COMPLETED`, plus `FAILED`, `ABORTED`, `BASELINE_FAILED`, `BASELINE_PARTIAL`. La reprise (`varia fuzz --resume <run>`) se fait à une frontière de phase ou de mutation : chaque résultat est persisté dès qu'il est ingéré.

---

## 8. Baseline

### 8.1 Objectif
Vérifier que les tests démarrent et passent ; lister tests et appels observés ; capturer les valeurs réelles ; mesurer la couverture disponible.

### 8.2 Données
Tests, statut, assertions, durée, stdout, stderr, erreurs, piles, couverture (lignes, instructions, fonctions, branches), mémoire si disponible ; par call site : target, arguments (valeurs sérialisées), type de résultat (retour/erreur), durée.

### 8.3 Baseline invalide
`BASELINE_FAILED` (exit 2). Pas de fuzz. `varia baseline --allow-failing` : observation et diagnostic seulement. `varia fuzz --force` : fuzz **uniquement** des tests verts, run marqué `BASELINE_PARTIAL`.

### 8.4 Stabilité
`baseline.stability_runs` (défaut 2 ; 1 en `quick`). Compare : statut du test, nombre et identité des call sites, **empreinte des arguments observés**, erreurs critiques. Écart ⇒ test `FLAKY` ; exclu du fuzz, **listé**. Les variations de durée seules ne rendent pas un test instable. Appels aux arguments non déterministes (date, uuid, aléatoire) ⇒ `NON_DETERMINISTIC_INPUT` : la mutation reste possible mais le call site est marqué fragile ; Varia suggère d'épingler l'horloge/l'aléa via `test.env`.

---

## 9. Adapters

### 9.1 Support
Jalon J1 : Jest. J2 : Vitest. Tout autre runner est hors support officiel jusqu'au jalon J4.

### 9.2 Interface
```ts
interface TestAdapter {
  id: string
  detect(project: ProjectInfo): Promise<DetectResult>
  capabilities(): AdapterCapabilities
  discover(o: DiscoverOptions): Promise<TestCase[]>
  prepareProbe(ctx: ProbeContext): Promise<ProbeHandle>
  run(o: RunOptions): Promise<TestRun>          // une sélection de tests
  parseResult(raw: RawOutput): TestRun
  cleanup(h: ProbeHandle): Promise<void>
}
interface AdapterCapabilities {
  observation: boolean; argumentMutation: boolean; perTestSelection: boolean
  asyncTargets: boolean; esm: boolean; cjs: boolean; mocks: boolean
  testParameters: boolean; coverage: boolean; isolatedProcess: boolean; parallelSafe: boolean
}
```
Une capability non supportée n'est jamais présentée comme disponible. `varia doctor` affiche les capabilities **effectivement vérifiées** sur le projet (test de fumée de la sonde), pas seulement déclarées.

### 9.3 Suite de conformité
Tout adapter doit passer `@varia/adapter-conformance` (observation, mutation d'un chemin, async, appels multiples, exception, test paramétré, nettoyage).

---

## 10. Sonde : mécanisme central

### 10.0 Comment les targets sont enveloppées (nouveau, point le plus risqué)
La sonde ne devine rien dans les fichiers de test : elle **enveloppe les fonctions exportées des modules ciblés** au chargement.

- **Mécanisme (Jest, J1) :** un `transform` Jest temporaire (déclaré dans une configuration générée hors du projet, §5) s'applique **uniquement** aux fichiers correspondant à `targets.include`. Il délègue d'abord à la transformation d'origine du projet (ts-jest, babel-jest, swc…) puis **ajoute en fin de module** un appel à `__varia.wrapExports(module.exports, "<module>")` (CommonJS). Chaque export fonction est remplacé par une fonction enveloppe qui appelle l'originale ; les propriétés (`name`, `length`, statiques) sont recopiées.
- **Mécanisme ESM (J2) :** transformation des déclarations `export` en liaisons passant par l'enveloppe, ou hook de chargement du runner ; dépend de la capability `esm` vérifiée.
- **Mécanisme Vitest (J2) :** plugin Vite temporaire jouant le même rôle.
- **Cache :** le cache de transformation du runner est redirigé vers un répertoire dédié au run (§33.3) pour ne jamais servir un module non enveloppé (ou enveloppé d'un run précédent).
- **Source maps :** la transformation conserve les source maps afin que les piles pointent vers le code d'origine.

**Limites assumées et affichées :**
1. Seuls les appels qui **passent par l'export** sont observés. Un appel direct entre deux fonctions du **même module** (non via `exports`) n'est **pas** observé ni muté ; la fonction concernée n'est une target que si un test ou un autre module l'appelle par son export.
2. Une fonction dont la référence a été **capturée avant** l'enveloppement (ex. `const f = require('./m').f` exécuté au chargement d'un module non transformé) peut échapper à l'enveloppe ; Varia le détecte quand l'appel attendu (couverture) n'est pas observé et le signale `UNOBSERVED_COVERED_TARGET`.
3. Les modules de `node_modules` ne sont jamais enveloppés par défaut.
4. L'enveloppe ajoute un surcoût mesuré en baseline (`probe_overhead_pct`) et affiché.

### 10.1 Principe
La sonde intervient à la **frontière d'appel** d'une target :

```text
baseline : appel réel → capture des arguments → fonction réelle → capture résultat/erreur
fuzz     : appel réel → identifier le call site → vérifier l'empreinte d'origine
           → remplacer UN chemin dans une copie → fonction réelle → capture résultat/erreur
```
L'objet d'origine n'est jamais modifié ; la mutation s'applique à une copie profonde.

### 10.2 Observation (contenu minimal)
Test, call site, fonction, module, séquence, arguments sérialisés (valeurs étiquetées, §10.7), durée, issue (retourné/levé/rejeté).

### 10.3 Mutation d'un chemin
Un seul chemin par défaut (`arg0.name`). Les autres arguments et chemins restent à leur valeur d'origine.

### 10.4 Identité d'un call site (corrigée)
`callSiteId = hash(testId, module, export, depth, sequence)` où `sequence` est le rang de l'appel **à cette target, à cette profondeur, dans ce test** (profondeur : §10.11). Pour détecter une dérive entre baseline et fuzz, la sonde calcule à l'appel l'**empreinte des arguments d'origine** et la compare à celle de la baseline :

- identique ⇒ la mutation est appliquée ;
- différente ⇒ `SKIPPED / AMBIGUOUS_CALL_SITE` (jamais appliquée « au hasard »).

### 10.5 Plafonds d'observation
Maximum N appels enregistrés par target et par test (défaut 20, échantillon déterministe : premier, dernier, intermédiaires par graine). Profondeur et taille de sérialisation limitées (résumé : type + taille + empreinte). Références circulaires marquées, jamais de boucle.

### 10.6 Transport et écriture (nouveau)
- La sonde écrit **uniquement** des fichiers **JSON Lines** append-only dans le dossier `tmp/` du run (un fichier par processus de test), en vidant le tampon à chaque message `RESULT`/`END`.
- **Redaction dans la sonde :** les chemins dont le nom correspond à `redaction.fields` / `redaction.patterns`, ainsi que les chemins en `inputs.skip`, sont remplacés **avant écriture** par `{"$redacted": true, "fingerprint": "<hmac>", "type": "<type>"}`. Les valeurs brutes sensibles n'atteignent donc **jamais** le disque. Ces chemins ne sont pas mutés (leur valeur d'origine reste en mémoire dans le processus de test, intacte). Les messages d'erreur et piles sont passés au même filtre avant écriture.
- Les journaux JSONL et plans temporaires sont **supprimés après ingestion** réussie (conservés sur échec avec `--keep-tmp`, après redaction).
- Le plan de mutation est un fichier JSON **lu** par la sonde ; elle ne reçoit rien par réseau.
- L'**orchestrateur** relit ces journaux, les valide (schéma versionné) et les ingère dans SQLite. Il est la **seule** écrivaine de la base. La sonde n'a donc aucune dépendance réseau ni accès à la DB.
- Si le processus est tué, le journal reste exploitable jusqu'à la dernière ligne complète ; une ligne tronquée est ignorée et signalée `PROBE_TRUNCATED`.
- Messages : `HELLO`, `OBSERVE_CALL`, `MUTATE_CALL`, `TARGET_RETURN`, `TARGET_THROW`, `TARGET_REJECT`, `TEST_END`, `PROBE_ERROR`. Chaque message : `protocolVersion`, `runId`, `testId`, `callSiteId`, `sequence`, `timestamp`, `payload`.

### 10.7 Valeurs sérialisées
Types étiquetés pour ne rien perdre au JSON : `undefined`, `NaN`, `±Infinity`, `-0`, `bigint`, `Date`, `RegExp`, `Map`, `Set`, `Buffer`, `Error`, `symbol`. Les fonctions, flux, sockets, instances natives : `OPAQUE`.

### 10.8 Async
Si la target retourne une promesse, la sonde l'attend et distingue **retour résolu** (`TARGET_RETURN`), **rejet** (`TARGET_REJECT`) et **levée synchrone** (`TARGET_THROW`). Un rejet **non attendu** ou non géré hors du call site est un signal de processus (`unhandledRejection`) classé séparément (§18). Les générateurs, observables et callbacks sont `OPAQUE` en J1.

### 10.9 Tests paramétrés et identité de test
Un `test.each` / `it.each` produit des tests distincts ; leur `testId` est dérivé du chemin complet (fichier, suites, titre **résolu**) plus l'indice du cas. Deux tests de même titre résolu dans un même fichier reçoivent un suffixe stable d'ordre. La sélection d'un test au rejeu passe par le mécanisme `perTestSelection` de l'adapter ; si l'adapter ne peut pas isoler un test, il relance le fichier et Varia **n'applique la mutation qu'au testId visé** (les autres tests du fichier s'exécutent sans mutation, leur résultat est ignoré).

### 10.11 Profondeur d'appel (nouveau)
La profondeur est suivie par un contexte asynchrone (`AsyncLocalStorage` en Node), **pas** par un simple compteur global : avec des appels `async` entrelacés, un compteur partagé attribuerait une mauvaise profondeur. L'état de la sonde (séquences, plan chargé, contexte) vit sur `globalThis.__varia`, jamais dans une variable de module, car `jest.resetModules` / `jest.isolateModules` rechargent les modules et remettraient les compteurs à zéro. Une enveloppe appelée **alors qu'une autre enveloppe est active** a `depth ≥ 1` (appel transitif) ; un appel venant directement du code de test a `depth = 0`.

- `targets.depth: direct` (**défaut**) : seuls les appels `depth = 0` sont des cibles de mutation. Les appels transitifs sont **observés** (pour le rapport et la couverture de targets) mais non mutés.
- `targets.depth: all` : les appels transitifs sont aussi mutés. Chaque issue indique alors `depth` ; une issue levée sur un appel transitif est marquée `TRANSITIVE` car la valeur mutée peut être **impossible** en production (l'appelant la valide peut-être déjà). Ces issues sont filtrables et ne comptent pas dans `ci.fail_on` sauf `ci.include_transitive: true`.
- Justification : muter un argument transitif revient à tester une fonction interne avec une entrée que son appelant ne produirait jamais ; c'est utile mais ce n'est pas le même verdict.

### 10.10 Mocks
Une target remplacée par un mock dans un test est **non observable** (`MOCKED_TARGET`) et listée. Les arguments reçus par un mock peuvent être observés si la capability `mocks` est vérifiée ; c'est une observation secondaire, jamais une cible de mutation en J1.

---

## 11. Découverte des targets

| Mode | Fonctionnement |
|------|----------------|
| `declared` | Seules les fonctions listées. Le plus déterministe. |
| `auto` | La sonde enveloppe **tous** les exports fonctions des modules `include` ; l'**observation en baseline** détermine quelles targets sont réellement appelées (aucun outil de couverture requis). Filtres : modules exclus, fonctions sans argument, triviales, volume d'appels excessif. Les exports jamais appelés par les tests sont rapportés `NEVER_CALLED` (cible qu'aucun test n'exerce). |
| `hybrid` | `auto` plus ajouts/retraits explicites. |

`auto` n'est pas une garantie de couverture. Le rapport affiche : *targets découvertes / observées / opaques / non supportées / mockées*. Les méthodes de classes exportées sont ciblables ; les instances construites par le test sont conservées telles quelles (seuls les arguments sont mutés).

---

## 12. Catalogue d'inputs

### 12.1 Contenu
Par input : call site, chemin, type runtime, type statique éventuel (signature TypeScript), format détecté, taille, bornes observées, mutable (oui/non), raison si non mutable.

### 12.2 Types
string, number, bigint, boolean, null, undefined, array, object, date, regexp, error, symbol, function (opaque), valeur opaque.

### 12.3 Hints et bornes (restauré)
```yaml
inputs:
  hints:
    - path: "createUser#arg0.age"
      range: [0, 150]
    - path: "createUser#arg0.email"
      format: email
    - path: "createUser#arg0.name"
      length: [1, 80]
  skip:
    - "createUser#arg0.password"
```
Sans hint, aucune borne n'est **inventée** : `boundary` n'utilise alors que les bornes **observées** (min/max vus sur plusieurs appels) et les bornes **universelles** (`0`, `±1`, `MAX_SAFE_INTEGER`, longueur 0/1). Une borne issue d'un hint est marquée `declared`, une borne issue d'observation `observed`. Le rapport affiche la provenance.

### 12.4 Opaques
Valeurs non clonables ou à état externe ⇒ `OPAQUE`, jamais mutées, toujours listées avec la raison.

---

## 13. Moteur de mutation

### 13.1 Interface
```ts
interface MutationStrategy {
  id: string
  supports(input: InputDescriptor): boolean
  generate(input: InputDescriptor, ctx: MutationContext): MutationCandidate[]
}
```

### 13.2 Stratégies garanties
| Stratégie | Contenu |
|-----------|---------|
| `type` | Type de famille voisine (string→number/object/array, number→string/object/array, object→null/array/primitive, array→object/primitive) |
| `null` | `null` |
| `undefined` | `undefined`, propriété absente |
| `empty` | `""`, `" "`, `[]`, `{}` |
| `boundary` | `-1,0,1`, bornes déclarées/observées ±1, longueurs limites (§12.3) |
| `size` | Chaîne, tableau, imbrication plafonnés |
| `structure` | Champ supprimé / ajouté / remplacé / mal typé, tableau imbriqué, clés exotiques (`__proto__`, `constructor`) sur copies |
| `format` | Variantes invalides d'un format **reconnu avec confiance** (email, UUID, URL, date ISO, IP) |
| `encoding` | Accents, emoji, caractères de contrôle, RTL, combinaisons Unicode, chaînes malformées (plafonnées) |

Hors cœur : `semantic` (déduire la signification métier d'un nom de variable) et `type-confusion` par objets piégés (`toString`, `Proxy`) — extensions futures. Varia ne devine jamais le métier à partir d'un nom.

### 13.3 Catalogues de valeurs
String : `""`, `" "`, `"123"`, `"null"`, `"true"`, `"💀"`, `"é"`, `"漢字"`, `"abc\n"`, `"abc\u0000"`, longue chaîne plafonnée, `null`, `undefined`, `123`, `{}`, `[]`, `true`.
Number : `0`, `1`, `-1`, `-0`, `0.5`, `NaN`, `±Infinity`, `MAX_VALUE`, `MIN_VALUE`, `MAX_SAFE_INTEGER+1`, `"25"`, `null`, `undefined`, `{}`, `[]`.
Boolean : `0`, `1`, `"true"`, `"false"`, `null`, `undefined`, `{}`, `[]`.
Array : `[]`, `[null]`, `[""]`, `[1]`, `{}`, `"abc"`, `null`, `[1,null,{}]`, grand tableau plafonné, imbriqué, creux.
Object : `{}`, `null`, `[]`, `"abc"`, `123`, champ manquant (un par champ), champ à `null`, champ mal typé, propriétés en trop, imbrication profonde plafonnée.
Date : invalide, extrême, `null`. BigInt, Map, Set, Buffer : catalogues dédiés.

### 13.4 Sélection
`per_input` plafonne les mutations **par chemin**. Si le catalogue dépasse, sélection par : (1) au moins une mutation par stratégie activée, (2) diversité des types de résultat attendus, (3) priorité aux mutations ayant donné un crash dans l'historique, (4) tirage reproductible par graine.

### 13.5 Explosion combinatoire
Single-input par défaut (coût additif). `combine: false` par défaut. Les paires (`combine_max: 2`) sont **échantillonnées**, jamais énumérées, et réservées au mode `full`.

---

## 14. Plan de mutation

### 14.1 Contenu
Créé **avant** l'exécution et sauvegardé : graine, version Varia, version de schéma, commit git, empreinte de config, empreinte d'environnement, et pour chaque mutation : identifiant stable, call site, chemin, stratégie, valeur d'origine, valeur mutée.

### 14.2 Identifiant stable
`id = hash(callSiteId, chemin, stratégie, valeur mutée sérialisée)`.

### 14.3 Déterminisme
Mêmes (projet, commit, config, graine, version Varia) ⇒ même plan. Sinon `NON_DETERMINISTIC`. `varia plan --out plan.json` exporte ; `varia fuzz --plan plan.json` le rejoue.

### 14.4 Budgets
`limits.total_mutations`, `--max-time`, `--max-mutations`. Plan plus grand que le budget ⇒ échantillonnage **annoncé et enregistré** (« 12 400 possibles, 5 000 retenues »). Jamais d'arrêt silencieux.

---

## 15. Modes

| Mode | per_input | combine | Stratégies |
|------|-----------|---------|------------|
| quick | 3 | non | type, null, empty |
| normal | 10 | non | toutes |
| full | 20 | opt-in | toutes |

---

## 16. Exécution

### 16.1 Isolation
Référence : **1 mutation = 1 processus** détruit après usage. Plus lent, plus fiable. L'adapter peut déclarer un regroupement par lot (`isolatedProcess` + reset complet vérifié) ; sinon non.

### 16.2 Timeout
`execution.timeout_ms`. Dépassement ⇒ arbre de processus tué (Windows : `taskkill /T /F`, POSIX : groupe de processus), statut `TIMEOUT`. Un timeout absolu de run existe.

### 16.3 Ressources
`limits.max_output_bytes` (troncature marquée), mémoire (`memory_mb`) ; dépassement ⇒ `CRASH` de sous-type `RESOURCE_LIMIT`.

### 16.4 Reset d'environnement
```yaml
execution:
  reset:
    environment: true          # variables d'environnement du processus
    mocks: true                # reset des mocks du runner
    database: none             # none | command
    database_command: ""       # ex. restaurer un dump de test
    filesystem: none           # none | tmpdir | copy
```
Par défaut aucun reset de base ni de fichiers : le rapport affiche ce qui est (ou n'est pas) isolé.

### 16.5 Parallélisme
Défaut `1`. Au-delà : l'adapter doit être `parallelSafe`, le reset de base et de fichiers doit fournir une isolation **par worker** (`VARIA_WORKER_ID`, `VARIA_PORT_OFFSET`, `VARIA_TMPDIR`), et un **test d'interférence** (rejouer un échantillon seul et en parallèle, comparer les statuts) doit passer. Sinon refus ou repli séquentiel **annoncé**. Divergence détectée ⇒ `INTERFERENCE`, mutation rejouée seule.

### 16.6 Reprise et idempotence
Les résultats sont ingérés mutation par mutation, dédoublonnés par identifiant stable.

---

## 17. Capture du résultat

La sonde distingue : `TARGET_RESULT`, `TARGET_ERROR`, `TEST_RESULT`, `PROCESS_RESULT`, `INFRA_RESULT`.

```json
{"target":{"status":"THREW","error":{"name":"TypeError","message":"name.trim is not a function"}},
 "test":{"status":"FAILED"},"process":{"exitCode":1}}
```
Le `FAILED` du test n'est jamais utilisé seul pour déclarer un crash.

---

## 18. Oracle

### 18.1 Principe
L'oracle répond « que s'est-il passé au niveau de la cible ? », pas « le test est-il vert ? ». Il reçoit les observations **normalisées** ; la sonde ne contient aucune politique.

### 18.2 Statuts
`PASSED`, `HANDLED`, `EXPECTED_FAILURE`, `UNEXPECTED_FAILURE`, `CRASH`, `TIMEOUT`, `INFRA_ERROR`, `SKIPPED`. Sous-types : `SUSPICIOUS_ACCEPT` (de `PASSED`), `RESOURCE_LIMIT`, `UNHANDLED_REJECTION` (de `CRASH`), `DEPENDENCY_ERROR` (origine, §18.6).

### 18.3 Ordre d'évaluation
1 infrastructure → 2 timeout → 3 sortie anormale du processus → 4 mutation non appliquée (`SKIPPED`) → 5 erreur de la cible → 6 retour normal de la cible → 7 résultat du test comme **signal secondaire**.

### 18.4 `PASSED` et acceptation suspecte (corrigé)
Sans deviner le métier, `PASSED` est promu en `SUSPICIOUS_ACCEPT` **uniquement** dans ces deux cas, tous deux vérifiables mécaniquement :

1. **Violation de contrat déclaré (`HINT_VIOLATION`).** La mutation viole un `hint` explicite de l'utilisateur (`range`, `format`, `length`, §12.3) et la cible a retourné normalement. Le contrat vient de l'humain, pas d'une supposition.
2. **Écho de valeur de type changé (`ECHO`).** Toutes les conditions suivantes : (a) la stratégie est `type` ou `structure` et la mutation **change le type runtime** du chemin (ex. string → object) ; (b) la cible a retourné normalement (ou résolu sa promesse) ; (c) la valeur retournée contient, à n'importe quelle profondeur, une valeur **structurellement égale** à la valeur mutée **et** celle-ci n'est pas un primitif « banal » (`null`, `undefined`, `0`, `""`, `true`, `false`) — pour ces primitifs, l'écho n'est pas retenu car trop souvent fortuit. L'écho prouve que la cible a **propagé** une valeur du mauvais type sans la valider.

Chaque promotion enregistre sa **raison** (`HINT_VIOLATION` ou `ECHO` + chemin du retour où la valeur a été retrouvée). Elle est reproductible et testée (cas positifs et négatifs).

Toute autre acceptation reste `PASSED` (neutre, affichée séparément) : Varia ne prétend **pas** détecter toutes les acceptations fautives. `SUSPICIOUS_ACCEPT` n'est jamais un crash : gravité MEDIUM, filtrable (`oracle.suspicious_accept: report | ignore`).

### 18.5 `HANDLED`
Erreur correspondant à une règle explicite : nom, expression sur le nom, `code`, statut HTTP, chaîne d'héritage (`instanceof`), message par expression régulière.
```yaml
oracle:
  handled_errors:
    - name: ValidationError
    - name: ZodError
    - code: ERR_INVALID_ARG_TYPE
    - status: 400
```
Défauts reconnus : `ValidationError`, `ZodError`, `ValidationException`, `ValueError`, `InvalidArgumentException`, `IllegalArgumentException`.

### 18.6 `CRASH` et origine
`TypeError`, `ReferenceError`, `RangeError` sont candidats à `CRASH` (règle configurable via `oracle.crash_errors`, jamais absolue). Une erreur levée dans une dépendance tierce (`node_modules`) est `DEPENDENCY_ERROR` : conservée et signalée, catégorie distincte (le code du projet n'a pas protégé l'appel).

### 18.7 Erreur inconnue
`UNEXPECTED_FAILURE`, ni correcte ni incorrecte d'office. `varia oracle suggest` parcourt les `UNEXPECTED_FAILURE` du dernier run et propose, un par un, de les classer en `HANDLED` ou `CRASH` (écrit dans `varia.yml` après confirmation).

### 18.8 Signaux de processus
Signal fatal, processus tué, OOM, sortie anormale, `unhandledRejection` ⇒ `CRASH`.

### 18.9 Autres signaux
`SLOW` (durée > k × baseline, drapeau, gravité LOW), sortie stderr inhabituelle.

---

## 19. Gravité
`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO`, par règles explicites : `TIMEOUT`/`CRASH` de processus/`RESOURCE_LIMIT` → CRITICAL ; `CRASH` d'une erreur de programmation sur entrée mal typée → HIGH ; `UNEXPECTED_FAILURE`/`SUSPICIOUS_ACCEPT`/`DEPENDENCY_ERROR` → MEDIUM ; `SLOW` → LOW ; `PASSED` → INFO. La gravité ne cache jamais une issue.

---

## 20. Issues et regroupement

### 20.1 Empreinte primaire
`type d'erreur + target + premier cadre de pile dans le projet (normalisé) + message normalisé`. Normalisation : chemins relatifs, valeurs littérales remplacées par des marqueurs de type, colonnes ignorées.

### 20.2 Empreinte secondaire
Quand la primaire change (refactorisation) : module de la target, similarité de pile, hash de l'extrait de code. Un rapprochement exige un score au-dessus d'un seuil documenté.

### 20.3 Ambiguïté
Deux correspondances plausibles ⇒ `AMBIGUOUS_MATCH`, pas de fusion automatique.

### 20.4 États
`NEW`, `UNCHANGED`, `FIXED`, `REGRESSION`, `IMPROVED`, `WORSENED`, `UNKNOWN`. `UNKNOWN` plutôt qu'une fausse certitude.

---

## 21. Acceptations
```yaml
acceptances:
  - mutation_pattern: { function: createUser, path: arg0.age, strategy: boundary }
    reason: "Valeur autorisée par le domaine"
    owner: team-users
    expires: 2027-06-30
```
Identifiée, expliquée, recherchable, expirable, supprimable. Une acceptation expirée redevient visible ; une acceptation sans correspondance est signalée obsolète. Stockage au choix : `varia.yml` (versionné avec le projet) **ou** base.

Structure de configuration (corrigée) :
```yaml
acceptances:
  store: file            # file | db
  items:
    - mutation_pattern: { function: createUser, path: arg0.age, strategy: boundary }
      reason: "Valeur autorisée par le domaine"
      owner: team-users
      expires: 2027-06-30
```
(L'exemple ci-dessus utilise la forme abrégée `acceptances: [...]`, acceptée comme équivalent de `store: file` + `items`.)

---

## 22. Métriques
Comptes bruts toujours affichés : mutations, handled, expected, passed, suspicious, unexpected, crashes, timeouts, skipped, infra, issues. Le taux de résilience (`handled+expected+passed_non_suspect` ÷ mutations exécutables, hors `SKIPPED`/`INFRA_ERROR`) est **secondaire** et toujours accompagné des comptes ; un crash critique reste dominant à l'écran.

**Couverture de mutation** : targets mutées / découvertes, inputs mutés / mutables. Elle montre ce qui n'a **pas** été testé.

---

## 23. Couverture
Baseline : lignes, instructions, fonctions, branches (selon adapter). Couverture sous fuzz : optionnelle (`coverage.mutation_coverage`), pour montrer les branches d'erreur atteintes grâce aux mutations ; jamais une preuve de robustesse.

---

## 24. Base de données

SQLite locale (WAL), Drizzle, migrations versionnées et testées. **Écrivaine unique : l'orchestrateur.**

| Table | Champs principaux |
|-------|-------------------|
| `projects` | id, nom, chemin, framework |
| `runs` | id, projet, état, mode, graine, commit, branche, version Varia, empreintes config/env, dates |
| `config_snapshots` | run, configuration résolue (secrets masqués) |
| `tests` | id, run, fichier, suites, titre résolu, indice de cas |
| `test_executions` | test, phase, statut, durée, sorties tronquées, code de sortie |
| `call_sites` | id, test, target, séquence, empreinte des arguments |
| `inputs` | call_site, chemin, type, format, bornes + provenance, mutable, raison |
| `mutations` | id stable, call_site, chemin, stratégie, valeur d'origine, valeur mutée |
| `mutation_results` | mutation, statut, sous-type, drapeaux, durée, erreur, origine |
| `errors` | id, nom, message normalisé, pile normalisée, empreinte |
| `issues`, `issue_occurrences` | id stable, empreinte(s), gravité, première apparition ; run, état, nombre |
| `acceptances` | cible, raison, propriétaire, expiration |
| `coverage` | run, fichier, métriques baseline/fuzz |
| `artifacts`, `events` | fichiers volumineux ; journal d'événements |

Valeurs sensibles masquées **avant** stockage (`redaction.store_raw_values: false` par défaut : on conserve une empreinte). Rétention `storage.retention_runs` (défaut 50) ; `varia prune` purge en conservant issues et acceptations ; `varia db backup|check`.

---

## 25. API locale

### 25.1 Rôle et limites
Lecture pour le dashboard et les intégrations locales. **Aucune route d'exécution arbitraire.** Les seules écritures publiques : création/suppression d'**acceptations**. L'ingestion des résultats ne passe **pas** par l'API (voir §10.6) : l'API ne peut donc pas devenir une seconde source de vérité.

### 25.2 Sécurité
Loopback (`127.0.0.1`) par défaut, jeton local par démarrage pour les écritures, CORS restreint, corps limités, CSP stricte sur le dashboard, échappement de toute valeur affichée (une valeur mutée est une donnée hostile).

### 25.3 Routes (`/api/v1`)
`GET /runs`, `/runs/:id`, `/runs/:id/summary`, `/runs/:id/issues`, `/runs/:id/coverage`, `/runs/:id/diff?against=`, `/issues/:id`, `/issues/:id/history`, `/mutations/:id`, `/tests/:id`, `/reports/:id`, `/health`, `/version` ; `POST|DELETE /acceptations`. Schéma OpenAPI 3.1 publié ; rupture ⇒ `/api/v2`.

---

## 26. Dashboard

Local, React + Vite, sans CDN, thème clair/sombre, accessible, pagination serveur et listes virtualisées. Valeurs masquées selon `redaction`.

**Niveau 1 (J1) :** Overview, Runs, Issues, Issue detail, Mutation (original, mutée, stratégie, chemin, target, résultat, erreur, pile, commande de rejeu), **Not covered**.
**Niveau 2 (J2–J3) :** Folders/Files/Tests/Call sites, Coverage, History (tendances), comparaison de deux runs, gestion des acceptations, capabilities et limitations du run.

Navigation : `Projet → Run → Dossier → Fichier → Test → Call site → Mutation → Erreur`, filtres dans l'URL.

---

## 27. CLI

```text
varia init | doctor | config --check/--print | baseline | plan | fuzz | test
varia replay <mutation-id> | report | dashboard | compare <a> <b> | ci
varia accept <issue> | oracle suggest | prune | clean | db backup|check | list | version
```
Ciblage : `--test`, `--file`, `--function`, `--strategy`, `--changed`, `--seed`, `--quick|--full`, `--data-dir`, `--max-time`, `--max-mutations`, `--resume`, `--plan`.

**Exit codes :** 0 OK selon la politique · 1 problème de résilience · 2 baseline invalide · 3 configuration invalide · 4 infrastructure · 5 sonde/capability non supportée · 130 interruption.

---

## 28. CI
`varia ci` : non interactif, sans dashboard. Formats : CLI, JSON, JUnit, SARIF, Markdown, annotations GitHub. Politique :
```yaml
ci:
  fail_on: [CRASH, TIMEOUT]
  fail_on_regression: true
  fail_on_new_only_against: main     # adoption progressive : échoue seulement sur les NOUVELLES issues
```
Cache de la base entre jobs via `--data-dir`. Modèles fournis pour GitHub Actions, GitLab CI, Jenkins, Azure DevOps.

---

## 29. Mode incrémental
`--changed` = optimisation, jamais source de vérité : `git diff` → fichiers → targets concernées → tests associés (via couverture de baseline) → mutations ciblées. Portée indéterminable ⇒ repli `full` ou arrêt selon `incremental.on_unknown`. Un run partiel est **toujours étiqueté partiel** dans le rapport.

---

## 30. Cache
Opt-in (`cache.enabled: true`). Réutilisation d'un résultat seulement si l'empreinte correspond : version Varia, version adapter, commit **et contenu** des fichiers de la target et de ses dépendances importées, définition de la mutation, empreinte de config, empreinte d'environnement. Sinon `CACHE_MISS`. `--no-cache` force. Un cache incorrect est pire qu'une exécution lente.

---

## 31. Rapports
CLI, JSON (schéma versionné), HTML autonome, JUnit XML, SARIF, Markdown. Contenu : version, run, graine, configuration résolue, baseline, capabilities **vérifiées**, mutations, résultats, issues, couverture, éléments non couverts, comparaison, limitations, empreinte de reproductibilité.

---

## 32. Sécurité et confidentialité

1. **Redaction** par défaut : `password`, `token`, `apiKey`, `authorization`, `cookie`, `secret`, `privateKey` + motifs configurés, appliquée aux valeurs, piles, messages, stdout/stderr, rapports.
2. **Valeurs mutées** = données hostiles : jamais exécutées dans le processus Varia ; mutations (dont `__proto__`) appliquées seulement dans le processus de test jetable, sur copies.
3. **Réseau :** le cœur n'émet aucune requête sortante ; aucune télémétrie.
4. **Base de données :** refus par défaut des environnements manifestement non destinés aux tests (heuristique + `VARIA_ALLOW_UNSAFE_DB`). Ce n'est pas une garantie absolue ; le développeur reste responsable.
5. **Limites dures** (non contournables par configuration) : longueur de chaîne, taille de tableau, profondeur, mémoire, temps, nombre de mutations.
6. **Chaîne d'approvisionnement :** dépendances minimales et épinglées, lockfile, audit en CI, licence claire.
7. **Usage :** Varia teste **ses propres** applications ; aucune fonction de ciblage réseau distant.

---

## 33. Effets de bord

### 33.1 Classification
Le rapport classe les tests : pur / filesystem / base / réseau (heuristique par imports et appels observés, jamais garantie).

### 33.2 Valeurs par défaut
`parallelism = 1`, `reset.database = none`, `reset.filesystem = none`. Un reset nécessaire doit être configuré explicitement.

### 33.3 Écritures du runner (nouveau)
Les runners écrivent eux-mêmes dans le projet (cache Jest, snapshots, rapports de couverture, fichiers temporaires). Varia : redirige le **cache de transformation** (obligatoire : sinon un module enveloppé d'un run précédent, ou non enveloppé, serait servi, §10.0), le cache du runner et la couverture vers un répertoire de `tmp/` **propre au run** quand le runner le permet ; lance les mutations en mode **« snapshots en lecture seule »** (`--ci` pour Jest) pour ne pas écrire de snapshot sur une valeur mutée ; vérifie l'état du projet avant/après (§5) et signale toute dérive.

---

## 34. Matrice de compatibilité (à vérifier, pas à présumer)

Cible de support par jalon, **à confirmer par J0 puis par `varia doctor` sur chaque projet** :

| Cas | Jest | Vitest |
|-----|------|--------|
| CommonJS (JS) | J1 | J2 |
| TypeScript transpilé (ts-jest, babel, swc) | J1 | J2 |
| ESM natif | J2 (si le runner l'expose) | J2 |
| async / promesses | J1 | J2 |
| `test.each` | J1 | J2 |
| mocks | partiel (`MOCKED_TARGET`) J1 | partiel J2 |
| classes (méthodes) | ciblage limité J2 | ciblage limité J2 |
| appels internes au même module | **non observés** (§10.0) | **non observés** |
| fonctions non exportées | non garanti | non garanti |
| import dynamique | non garanti | non garanti |

Le dashboard affiche les limitations réelles du run.

---

## 35. Performance
Pas de promesse de durée. Varia **mesure** : baseline, observation, plan, exécution, analyse. Objectifs : peu d'allocations, données stockées limitées, ne pas exécuter une mutation éliminée, interruption propre, reprise. Le coût dominant est le démarrage d'un processus de runner par mutation (souvent 1 à 5 s avec Jest/ts-jest) : 1 400 mutations peuvent dépasser **une heure** en séquentiel. Conséquences :
- **`varia plan` affiche une estimation de durée** avant toute exécution : `mutations × (coût de démarrage mesuré en baseline + durée du test visé)`, avec l'avertissement si elle dépasse `execution.warn_after` (défaut 30 min) et la proposition de réduire (`--quick`, `--max-time`, `--file`, `targets.mode: declared`).
- Le défaut sûr reste « une mutation = un processus » (§16.1). L'**exécution par lot** (plusieurs mutations dans un processus, `jest.resetModules` entre chaque) est un chantier **J3**, activable seulement si le test d'interférence (§16.5) montre des résultats identiques à l'exécution isolée sur un échantillon représentatif (≥ 5 % des mutations, minimum 50). Sans cette preuve, elle est refusée.
- La sélection d'une seule mutation à rejouer (`varia replay`) reste immédiate.

---

## 36. Qualité de Varia
- Tests unitaires, intégration, non-régression, erreurs, reproductibilité ; tests de la sonde (primitifs, objets, tableaux, null, async, appels multiples, exceptions, mocks, ESM/CJS selon capability) ; chaque règle d'oracle testée une à une ; tests d'architecture (§6).
- **Projet exemple** (`examples/jest-project/`) : `createUser` avec validation correcte, `ValidationError` volontaire, `TypeError` volontaire sur mauvais type, une fonction qui **renvoie telle quelle** une valeur d'un type invalide (cas `SUSPICIOUS_ACCEPT` / `ECHO`), une fonction asynchrone, un `test.each`, une target qui en appelle une autre (cas `depth`), un appel interne au même module (doit rester **non observé** et apparaître dans le rapport). Varia doit trouver `null → HANDLED`, `{} → CRASH`, l'acceptation suspecte, et ne jamais classer la validation correcte en crash.
- **Dogfooding** à partir de J3 : Varia fuzzé par Varia.
- TypeScript strict, lint à zéro, CI Windows/macOS/Linux, versionnement sémantique, journal des modifications.
- Couverture visée : ≥ 90 % sur core, mutation-engine, analyzer.

---

## 37. Dépôt
```text
varia/
├── bin/varia
├── packages/ core · config · cli · database · probe-protocol · probe-runtime
│             mutation-engine · execution-engine · analyzer · reporters
│             api · dashboard · testkit · adapters/{jest,vitest}
├── docs/  getting-started · configuration · probe-protocol · oracle
│          adapter-capabilities · writing-an-adapter · ci
├── examples/jest-project/
├── tests/   CLAUDE.md   package.json   README.md
```
Chaque dossier a son `README.md`.

## 38. Pile technique
Node.js 20+, TypeScript strict, Commander, Zod + JSON Schema, SQLite (`better-sqlite3`) + Drizzle, Fastify, React + Vite + Tailwind, Vitest (tests de Varia), pino, TypeScript Compiler API, npm workspaces, GitHub Actions multi-OS. Aucune dépendance cloud.

## 39. Extensibilité
Interfaces internes : `TestAdapter`, `MutationStrategy`, `OracleRule`, `Reporter`, `FormatDetector`. Pas de promesse de compatibilité publique avant J4 (ordre : cœur stable → adapters stables → protocole stable → plugins).

---

## 40. Protocole de la sonde
Voir §10.6 (transport, messages, écriture). La sonde est **indépendante du langage** autant que possible : un adapter externe (Python, PHP, Java) n'a qu'à produire/consommer les mêmes JSONL et lire le même plan. Spécification complète dans `docs/probe-protocol.md` (versionnée, avec jeux de test de conformité).

## 41. Séparation sonde / normaliseur / oracle
```text
Sonde → observation brute → Normaliseur → Oracle → Classification → Analyseur
```
La sonde dit « la cible a levé `TypeError` ». Elle ne dit jamais « c'est mauvais ». Le normaliseur unifie les formes d'erreur entre runners (Jest/Vitest) et nettoie les piles.

## 42. Reproductibilité
`varia replay <mutation-id>` utilise le plan sauvegardé, la mutation exacte, la config résolue, la graine, le commit, la version. Environnement différent ⇒ `ENVIRONMENT_CHANGED`, sans prétendre à un résultat strictement identique.

## 43. Journal d'événements
`RUN_STARTED`, `BASELINE_STARTED/COMPLETED`, `OBSERVATION_STARTED/COMPLETED`, `PLAN_CREATED`, `MUTATION_STARTED/COMPLETED`, `ISSUE_CREATED`, `RUN_COMPLETED`, plus erreurs. Sert à la reprise, au debug, au dashboard.

## 44. Erreurs de Varia
`PROJECT_FAILURE`, `PROBE_FAILURE`, `RUNNER_FAILURE`, `INFRA_FAILURE`, `CONFIG_FAILURE`, `VARIA_INTERNAL_FAILURE`, `PROJECT_MUTATED`. Le rapport précise toujours l'origine ; une erreur de Varia n'est jamais comptée comme résilience du projet.

---

## 45. Feuille de route par jalons

### J0 — Spike (obligatoire, 1 à 3 jours)
**Spécification :** partie C (scénarios J0-1 à J0-20) ; **stratégies d'injection et règle de repli :** partie D. Ni DB, ni dashboard, ni API, ni monorepo complet en J0 : un dossier `spike/` suffit.
**Livrable :** `reports/j0.md` avec verdict `GO` ou `NO-GO`, stratégie retenue, mesures, périmètre de J1 déduit de J0-19/J0-20.
**NO-GO ⇒ l'agent s'arrête (A.4-1)** ; le propriétaire révise alors le CDC sur la base du rapport.

### J1 — Cœur minimal (Jest)
Config ; SQLite ; baseline + stabilité ; sonde ; catalogue ; mutations du §13.2 ; plan ; exécution isolée ; oracle (dont `SUSPICIOUS_ACCEPT`) ; issues ; rejeu ; CLI (`init`, `doctor`, `baseline`, `plan`, `fuzz`, `test`, `replay`, `report`, `clean`) ; rapport JSON ; dashboard niveau 1 ; projet exemple.
**Périmètre technique J1 :** CommonJS et TypeScript transpilé par le transform du projet ; async ; `test.each` ; ESM natif **exclu** (J2).
**Acceptation (vérifiable par l'agent) :**
1. Tous les scénarios J0 restent verts, désormais via le vrai CLI (`varia test`) et non plus le script de spike.
2. Sur l'exemple : issues attendues trouvées (`createUser` ⇒ `TypeError` groupé en une issue ; `repeat` ⇒ `TIMEOUT` ; `exitOn` ⇒ `CRASH` ; `echoValue` ⇒ `SUSPICIOUS_ACCEPT/ECHO`), aucune validation correcte classée en crash.
3. Sur le projet externe choisi selon A.7 : baseline verte, plan généré, exécution complète ou plafonnée par budget **avec échantillonnage annoncé**, arbre du projet inchangé (§5), rapport JSON valide contre son schéma.
4. `varia doctor` répond `UNSUPPORTED_PROBE` clairement sur un projet ESM natif de test.
5. Reprise : tuer le processus Varia en cours de fuzz puis `varia fuzz --resume` ne rejoue aucune mutation déjà persistée.
6. Mutation manuelle du code de Varia (au moins 5 cas : oracle inversé, graine ignorée, redaction désactivée, timeout ignoré, plan non trié) ⇒ au moins un test échoue à chaque fois (preuve que les tests peuvent échouer).

**Point de contrôle :** après J1, l'agent s'arrête et attend une relecture du propriétaire **si et seulement si** le prompt de lancement contient `CHECKPOINT_AFTER_J1=true` ; sinon il enchaîne sur J2.

### J2 — Multi-runner et usage en équipe
Vitest ; ESM/CJS/async/mocks selon capabilities ; historique, comparaison, états d'issues ; acceptations ; couverture ; HTML ; `varia ci` (JUnit/SARIF) ; incrémental prudent ; cache sûr ; dashboard niveau 2.
**Acceptation :** utilisation réelle sur plusieurs projets JS ; mode « nouvelles issues seulement » en CI.

### J3 — Produit fiable
Durcissement sonde ; opaques ; appariement des causes racines amélioré ; performance ; reprise ; schémas et API stables ; multi-OS ; documentation ; dogfooding.

### J4 — Extensibilité
Protocole d'adapter stabilisé ; adapter `custom` ; Mocha ; Pytest ; PHPUnit ; JUnit ; stratégies externes ; testkit ; `varia scaffold`.

### J5+ — Intelligence optionnelle
Priorisation ; suggestions d'oracle ; stratégie `semantic` ; mutateurs d'état (retours de mocks, latence, erreurs réseau) ; chaos plus large ; adapter HTTP. Rien de tout cela n'est requis au fonctionnement.

---

## 46. Risques
| Risque | Niveau | Réponse |
|--------|--------|---------|
| Sonde fragile (ESM/CJS, TS, mocks) | Très élevé | J0, `doctor` avec test de fumée, capabilities vérifiées |
| Périmètre trop ambitieux | Très élevé | Jalons ; hors cœur explicite |
| Effets de bord (base, fichiers, réseau) | Élevé | Séquentiel, resets explicites, §33 |
| Faux positifs | Élevé | Oracle prudent, `oracle suggest`, acceptations, filtre `suspicious_accept` |
| Écritures du runner dans le projet | Élevé | §33.3, vérification d'état |
| Données sensibles | Élevé | Redaction avant stockage |
| Identité de call site instable | Moyen | Séquence + empreinte d'arguments, `AMBIGUOUS_CALL_SITE` |
| Empreintes d'issues instables | Moyen | Multi-signaux, `UNKNOWN` |
| Explosion des mutations | Moyen | Budgets, échantillonnage annoncé |
| Tests instables | Moyen | Baseline multiple |
| Windows (signaux, chemins, arbres) | Moyen | CI multi-OS dès J1 |
| Cache incorrect | Moyen | Opt-in, empreinte complète |

## 47. Hors périmètre (et dit)
Instrumentation universelle de tous les modules JS ; appels directs entre fonctions d'un même module (non vus de l'extérieur) ; fonctions non exportées en général ; objets natifs complexes ; annulation magique des effets réseau/base ; sémantique métier ; mutations multi-inputs exhaustives ; cause racine parfaite ; support universel des frameworks. Quand un cas n'est pas fiable : **Varia le dit**.

## 48. Critères d'acceptation globaux
1. Cloné séparément ; aucune dépendance Varia dans le projet cible ; `varia.yml` suffit.
2. Baseline stable exigée avant le fuzz normal.
3. Appels réels observés par la sonde ; mutation d'un seul chemin par défaut.
4. Plan déterministe par graine, sauvegardé, rejouable ; chaque mutation identifiée et rejouable.
5. Un crash ou un timeout n'empêche jamais les mutations suivantes.
6. Erreurs d'infrastructure séparées des erreurs du projet.
7. Le statut du test n'est jamais utilisé seul pour classifier.
8. Inputs opaques, targets non observées/mockées, tests flaky, mutations ignorées : **tous listés**.
9. Une acceptation de valeur invalide est signalée (`SUSPICIOUS_ACCEPT`) dans les deux cas définis (`HINT_VIOLATION`, `ECHO`), avec la raison enregistrée ; Varia ne prétend pas détecter toutes les acceptations fautives.
10. Valeurs sensibles masquées **dans la sonde, avant toute écriture disque** et avant stockage ; aucune requête réseau du cœur ; journaux temporaires purgés après ingestion.
10 bis. Les appels transitifs sont distingués (`depth`) et ne sont pas mutés par défaut.
10 ter. `varia plan` affiche une estimation de durée avant exécution.
11. Aucune modification durable du projet (vérifiée avant/après) ; `varia clean`.
12. La base n'a qu'une écrivaine (l'orchestrateur).
13. Dashboard local fonctionnel ; historique, comparaison, régressions, acceptations traçables.
14. Capabilities de Jest et Vitest déclarées **et vérifiées** par `doctor` ; jamais présentées comme supportées si elles ne le sont pas.
15. Ajouter un adapter ne nécessite aucune modification du cœur.
16. Windows, Linux, macOS en CI.
17. Le projet exemple contient un crash réel, une acceptation suspecte et une validation correcte.
18. J0 réussi avant toute implémentation importante.

---

## 49. Résumé
Varia prend les appels que tes tests font déjà réellement, leur fait subir des variations contrôlées et reproductibles, et te montre précisément comment ton code réagit — en disant honnêtement ce qu'il n'a pas pu observer ni rejouer.

**Règle de développement la plus importante :** Varia ne doit jamais donner l'impression d'avoir testé ce qu'il n'a pas réellement observé et rejoué. Exemple : « 1 000 mutations — 920 exécutées, 50 ignorées, 20 opaques, 10 non supportées », jamais « 1 000 mutations » si 600 seulement ont été injectées.

---

## Annexe A — Configuration minimale
```yaml
version: 1
project: { name: my-api }
test: { command: npm test, framework: jest }
targets: { mode: auto, include: ["src/**"] }
mutations: { mode: normal }
oracle:
  handled_errors: [{ name: ValidationError }, { name: ZodError }]
```

## Annexe B — Configuration recommandée
```yaml
version: 1
project: { name: my-api, path: . }
test:
  command: npm test
  framework: jest
  cwd: .
  env: { NODE_ENV: test }
baseline: { stability_runs: 2 }
targets:
  mode: hybrid
  include: ["src/**"]
  exclude: ["src/generated/**"]
inputs:
  hints:
    - { path: "createUser#arg0.age", range: [0, 150] }
  skip: ["createUser#arg0.password"]
mutations:
  mode: normal
  per_input: 10
  strategies: [type, null, undefined, empty, boundary, size, structure, format, encoding]
  seed: auto
  combine: false
  limits: { total_mutations: 10000, string_length: 100000, array_length: 10000, object_depth: 20, memory_mb: 512 }
execution:
  timeout_ms: 5000
  parallelism: 1
  isolation: process
  reset: { environment: true, mocks: true, database: none, filesystem: none }
oracle:
  handled_errors: [{ name: ValidationError }, { name: ZodError }, { code: ERR_INVALID_ARG_TYPE }]
  suspicious_accept: report
redaction:
  fields: [password, token, apiKey, authorization, cookie, secret, privateKey]
  store_raw_values: false
storage: { retention_runs: 50 }
cache: { enabled: false }
ci:
  fail_on: [CRASH, TIMEOUT]
  fail_on_regression: true
  fail_on_new_only_against: main
```

## Annexe C — Sortie CLI type
```text
VARIA · my-api · seed 48213
[1/8] Config ........ ✓   [2/8] Baseline ...... 148/148 ✓ (12,4 s)
[3/8] Stabilité ..... 2/2 ✓  [4/8] Observation .... 417 targets · 2 311 appels
[5/8] Inputs ........ 1 084 mutables · 9 opaques
[6/8] Plan .......... 1 420 mutations   [7/8] Exécution ... 1 420/1 420 (7 min 12)
[8/8] Analyse ....... 14 issues

Handled 1 213 · Expected 102 · Passed 12 (dont 5 suspects) · Unexpected 40
Crashes 53 · Timeouts 0 · Skipped 9
Nouvelles 4 · Régressions 1 · Corrigées 6
Non couvert : 9 inputs opaques · 3 tests instables · 2 call sites non supportés · 4 targets mockées
Rejeu : varia replay m_9f3a1c            Code de sortie : 1
```

## Annexe D — Prompt de lancement
Le message de lancement de l'agent (qui contient ce document) prime sur lui en cas de conflit : notamment le travail direct sur `main` et l'identité de marque « Varia par Orqea ».

*Fin de la révision 7.*
