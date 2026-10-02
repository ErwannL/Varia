# DECISIONS

Format : date — contexte — options — choix — raison.

## D-001 — 2026-10-01 — Ordre des premiers commits

- Contexte : le prompt demande à la fois « premier commit `.gitattributes` » et « `docs/SPEC.md` commitée seule ».
- Choix : commit 1 = `.gitattributes` seul, commit 2 = `docs/SPEC.md` seule.
- Raison : satisfait les deux exigences ; LF garanti avant l'arrivée du moindre fichier texte.

## D-002 — 2026-10-01 — Branche de travail

- Contexte : CDC A.2-2 (branche par jalon) vs prompt §1 (tout sur `main`).
- Choix : `main`, le prompt prime.

## D-003 — 2026-10-01 — Version de Node en développement

- Contexte : `.nvmrc` = 20 (exigé) ; l'environnement de l'agent fournit Node 22.22.0.
- Choix : développer sous Node 22, cibler la compatibilité Node 20 (pas d'API > 20), CI avec matrice
  Node 20 + 22. Le fonctionnement sous Node 20 est `UNVERIFIED` localement tant que la CI n'a pas tourné.

## D-004 — 2026-10-01 — Outillage

- Prettier épinglé 3.3.3 (exact), ESLint 9 + typescript-eslint `strict`, Vitest 3 (pool `forks`,
  fichiers séquentiels car les tests d'intégration lancent Jest).
- `Math.random` interdit par règle de lint (CDC B, mulberry32).

## D-005 — 2026-10-01 — `fetchUser` non déclarée `async`

- Contexte : C.0 exige à la fois `fetchUser (async)` et une **levée synchrone** de `TypeError` pour un objet ;
  une fonction `async` ne peut pas lever synchroniquement.
- Choix : fonction ordinaire qui lève synchroniquement pour un objet et renvoie une promesse
  (rejetée/résolue) sinon. Comportement observable identique à C.0 ; documenté dans l'exemple.

## D-006 — 2026-10-01 — Valeur déclarée `boom` pour `exitOn`

- Contexte : J0-9 exige une mutation qui provoque `process.exit(1)` ; aucun catalogue du §13.3 ne
  contient `"boom"`.
- Choix : extension `extraValues` (« valeurs déclarées » par chemin `export#argN…`, stratégie
  `declared`), dans la lignée des `hints` (§12.3) : le contrat vient de l'humain. Le plan J0 déclare
  `exitOn#arg0: ["boom"]`.

## D-007 — 2026-10-01 — Périmètre du grep J0-11

- Contexte : le test J0-11 cherchait les mots de passe dans **tout** le stockage ; il a échoué sur le
  cache de transformation Jest, qui contient une copie transpilée du **code source** des tests (où les
  mots de passe sont écrits en dur).
- Choix : le grep couvre les journaux JSONL et tous les fichiers écrits par Varia, hors `jest-cache/`.
  Ce n'est pas une fuite d'une valeur observée : c'est le code du projet. Le test était faux (trop
  large au regard de J0-11, qui vise les journaux JSONL).

## D-008 — 2026-10-01 — Test « une autre graine change la sélection » corrigé

- Contexte : le test utilisait `per_input = 3` ; la sélection (§13.4) prend d'abord une mutation par
  stratégie (5 stratégies), donc aucun tirage n'avait lieu et le test ne pouvait pas échouer si la
  graine était ignorée (révélé par `scripts/mutation-check.mjs`).
- Choix : `per_input = 8` (tirage effectif) + test unitaire dédié dans `spike/test/plan.test.ts`.

## D-009 — 2026-10-01 — Identité de marque (prompt §4.3)

- **Idée du logo** : un « V » blanc (la valeur attendue, le chemin normal) sur une tuile violette, et un
  point ambre décalé : la **valeur perturbée** qui s'écarte du chemin. Animation (CSS seul) : le point
  dérive doucement et le V oscille ; arrêt = logo fixe ; coupée sous `prefers-reduced-motion`.
- **Palette** : violet Varia `#4B32D6`, ambre `#FFC857`, encre `#14122B`, blanc, violet clair `#7C6BF0`.
  Tuile pleine : lisible sur fonds clair et sombre et à 16 px (aperçus `brand/previews/`).
- **Typographie** : polices **système** uniquement (aucune police web, exigence §4.4) ; le mot-symbole
  de l'image de partage est dessiné en tracés SVG (rendu identique partout, aucune police requise).
- Rastérisation : `@resvg/resvg-js` (déterministe, sans navigateur) ; `favicon.ico` assemblé par
  `scripts/brand.mjs` (PNG 16/32/48 embarqués).

## D-010 — 2026-10-01 — Styles du dashboard sans Tailwind

- Contexte : CDC §38 cite Tailwind ; le prompt (§4.4) laisse palette/mise en page/composants à l'agent.
- Choix : CSS simple à jetons (`packages/dashboard/src/styles.css`), sans dépendance de build CSS.
- Raison : jetons lisibles par un test de contraste WCAG (aucun seuil baissé), moins de dépendances
  natives, aucune ressource externe. Révisable si le propriétaire tient à Tailwind.

## D-011 — 2026-10-01 — Interface d'adapter simplifiée en J1

- `TestAdapter` = `detect`, `capabilities`, `prepare`, `run` ; `discover` et `parseResult` (§9.2) sont
  internes à `run` (les tests sont découverts par l'exécution elle-même). Le moteur reçoit l'adapter
  du CLI : il ne connaît aucun runner (test d'architecture).

## D-012 — 2026-10-01 — Superviseur de processus

- Le timeout est appliqué par un superviseur (`packages/core/runtime/supervisor.cjs`), chef de groupe
  détaché, et non par l'orchestrateur seul : si Varia est tué (`kill -9`, reprise J1-5), une mutation
  qui boucle est quand même tuée. Filet de sécurité côté orchestrateur : timeout + 5 s.

## D-013 — 2026-10-01 — Configuration hors du projet (`varia --config`)

- Pour le projet externe (A.7) et en général : un `varia.yml` dans le projet cible serait une
  modification du projet. `--config <fichier>` permet de garder la configuration ailleurs.

## D-014 — 2026-10-01 — Projet externe de J1 (A.7)

- Essai 1 : `aceakash/string-similarity` — rejeté (suite Jasmine, licence ISC).
- Essai 2 : `kolodny/immutability-helper` @ `3dc903960b8411da84704052d511c20648c45ead` — **retenu** :
  MIT, Jest (24.9) + ts-jest (preset), TypeScript transpilé en CommonJS, 82 tests, baseline verte sans
  réseau ni base. Récupéré par `scripts/fetch-external.mjs` dans `examples/external/` (ignoré par git).
- Il a révélé deux incompatibilités réelles de la sonde (préfixe `node:` et global `performance`
  absents sous Jest 24) et un bug (constructeurs ES5 enveloppés) — corrigés et testés.

## D-015 — 2026-10-01 — Défauts de configuration

- `mutations.limits.string_length` vaut 10 000 par défaut (annexe B recommande 100 000) : la stratégie
  `size` produit une chaîne de cette longueur par chemin ; 10 000 garde des plans de taille raisonnable.
  Plafond dur : 1 000 000. `execution.parallelism` n'accepte que 1 en J1 (§16.5 : refus annoncé).

## D-016 — 2026-10-01 — Textes de diagnostic en codes

- Les raisons de `doctor` et les erreurs de Varia sont des **codes** (`NATIVE_ESM`, `PROJECT_MUTATED`…)
  traduits au rendu (fr/en), jamais du texte stocké (prompt §4.1). Les détails techniques (chemins,
  messages Zod) restent des données affichées telles quelles.

## D-017 — 2026-10-01 — `VARIA_PUBLIC_URL`

- Documentée (prompt §4.5) mais **non lue** par Varia en J1 : elle servira à Orqea pour construire
  l'URL de l'iframe. Constat : Chromium bloque une page publique qui embarque `127.0.0.1`
  (Local Network Access) — consigné dans `docs/INTEGRATION.md`.

## D-018 — 2026-10-01 — Test des migrations mis à jour

- `database.test.ts` attendait la liste exacte `['0001']` ; l'ajout de la migration `0002_acceptances`
  (J2) rend cette attente fausse par construction. Le test liste désormais `['0001', '0002']` et un test
  de **montée de version** (base 0001 avec données → 0002, données conservées) est ajouté.

## D-019 — 2026-10-01 — Titre traduit des acceptations suspectes

- Le titre traduit perdait le chemin muté (« sur arg0.age »). Les issues `SUSPICIOUS_ACCEPT` portent
  désormais la raison (`errorName`) et le chemin (`message`) ; le test de `issueTitle`, qui figeait
  l'ancien format sans chemin, est mis à jour en conséquence (comportement volontairement changé).
- Les limites affichées dépendent des capacités de l'adapter (pas d'« ESM non supporté » sous Vitest).

## D-020 — 2026-10-01 — Mécanisme d'injection Vitest (J2)

- Contexte : §10.0 prévoit un « plugin Vite temporaire » ; un transform qui ajoute un pied de module ne
  peut pas remplacer des liaisons ESM.
- Choix : plugin `enforce: 'pre'` qui **réécrit les déclarations `export`** (analyse syntaxique
  TypeScript, `magic-string`, source map) pour réexporter des enveloppes ; appels internes au module
  inchangés (limite §10.0-1 identique à Jest). Non enveloppés : `export let/var`, classes (signalées
  `UNSUPPORTED`), défauts anonymes, ré-exports `from` (le module source est enveloppé lui-même).
- Vitest est lancé par son **API Node** (`startVitest`) depuis `runtime/run-vitest.mjs`, avec la copie de
  Vitest **du projet** : plugin, cache Vite et fichier de setup sont injectés sans aucun fichier dans le
  projet. Le setup (dans `tmp/`) importe la même instance de Vitest que les tests, puis `probe.install()`.
- Limite connue : une dépendance circulaire ESM qui appelle un export pendant l'évaluation du module
  (avant la fin de celui-ci) rencontrerait la zone morte temporelle des liaisons ajoutées.

## D-021 — 2026-10-01 — Second projet externe (Vitest) et robustesse face aux données hostiles

- `unjs/destr` @ `541b6f9aeada9fc30de9c5a7e086dbfc1c6fcdc7` (MIT, ESM, Vitest, 22 tests) : installation
  par `npm install` (le projet utilise pnpm, pas de `package-lock.json`) — **non strictement
  reproductible**, limite consignée.
- Il a révélé que la validation Zod des journaux de la sonde plantait sur des valeurs observées hostiles
  (`{"constructor": null}`) : les valeurs sont désormais vérifiées par un parcours défensif
  (`isJsonValue`), testé.
- Vitest sans fichier de config remontait jusqu'à la config du dépôt parent : `config: false`.

## D-022 — 2026-10-02 — Racine de projet canonique (CI macOS / Windows)

La CI multi-OS (jusqu'ici `UNVERIFIED`) échouait : sous macOS (`/var` → `/private/var`) et Windows
(noms courts `RUNNER~1`), la sonde et git rapportent des chemins réels alors que la racine reçue ne
l'était pas ; toutes les cibles étaient « hors projet » ⇒ zéro mutation, `--changed` vide. Correction
dans le **code** : `canonicalRoot` (`realpathSync.native`) dans `EngineContext` et `changedFiles`.
Reproduit sous Linux par un lien symbolique (`tests/j1/paths.test.ts`, vu échouer avant le correctif).
Effet : l'identifiant de projet d'une racine atteinte par un lien change (ces projets étaient cassés).
Test d'architecture : chemins POSIX (les comparaisons de préfixes échouaient sous Windows ; test faux,
non le code). Couverture de `proc.ts` dépendante du timing de la machine : tests déterministes ajoutés
pour `waitGroupGone` et l'échec de lancement (aucun seuil abaissé).

## D-023 — 2026-10-02 — Nouveau logo

Demande de l'utilisateur : un logo qui représente ce que fait l'application. Accolades `{ }` (données
d'entrée) frappées par un éclair ambre (perturbation). Couleurs, tuile, contraintes (CSS seul, coupure
sous reduced-motion, position d'arrêt = logo fixe) inchangées ; dérivés régénérés par `npm run brand`.

**Complément D-022 (test modifié)** : `packages/engine/test/context.test.ts` comparait `dataDir` au
chemin `tmpdir()` brut ; la racine étant désormais canonique (comportement voulu), le test crée sa racine
canonique. Le cas d'une racine non canonique reste couvert par `tests/j1/paths.test.ts`.

**Complément D-022 (Windows)** : `groupAlive` interrogeait un groupe POSIX (`kill(-pid, 0)`), notion
absente sous Windows ; il teste désormais le processus lui-même sous `win32`. `waitGroupGone` fonctionne
ainsi sur toutes les plateformes et son test s'exécute partout (la couverture de `proc.ts` n'est plus
dépendante de l'OS ; aucun seuil abaissé).

**Complément D-023** : retour de l'utilisateur, l'animation était imperceptible (décalage de 1,5 px) et
l'éclair semblait rogné (sommet plat). Éclair à pointe, entièrement dans la tuile ; animation nette
(chute et scintillement de l'éclair, accolades qui s'écartent sous le choc, boucle de 3 s), vérifiée
image par image dans Chromium en `<img>` comme dans le README.

## D-024 — 2026-10-02 — Mesure de couverture J3 (100 %, processus enfants)

- Contexte : J3 exige 100 % fichier par fichier sur tout le code livré, y compris le code exécuté
  hors du processus de test (sonde, superviseur, lanceur Vitest).
- Options : (a) NODE_V8_COVERAGE partout + fusion ; (b) tests en processus seulement ; (c) les deux.
- Choix : (c). `scripts/coverage.mjs` lance Vitest, propage `NODE_V8_COVERAGE` aux enfants (préchargement
  qui coupe la propagation aux runners du projet cible), puis convertit la couverture V8 brute des
  fichiers `runtime/` avec le convertisseur AST de Vitest (`ast-v8-to-istanbul`) et la source réelle.
- Constat : Vitest convertit un fichier chargé par le `require` natif avec la source TRANSFORMÉE par
  Vite (positions décalées : des branches « sinon » exécutées apparaissaient à 0, et inversement des
  branches non exécutées pouvaient paraître couvertes). Un fournisseur enveloppe
  (`scripts/vitest-coverage-provider.mjs`) conserve donc la couverture brute de ces fichiers, et la
  fusion REMPLACE l'entrée de Vitest ; un fichier `runtime/` chargé par Vite fait échouer la mesure.
- Le passage au convertisseur AST change la définition des instructions et des lignes : les seuils
  ont été reconstitués sur la nouvelle mesure (`coverage-thresholds.json`, plancher mesuré par
  fichier, 100 ailleurs) ; aucun n'a été abaissé depuis, et la cible finale est 100 partout.
- Code exécuté dans le contexte `vm` de Jest (sonde, transform) : non repris des enfants (décalage
  d'enveloppe) ; mesuré par des tests en processus (F-03).

## D-025 — 2026-10-02 — Sonde défensive et rejets non gérés (A-05, A-02)

- Toute erreur du code de la sonde est capturée : `PROBE_ERROR` (ou marqueur `[varia] PROBE_ERROR` sur
  stderr si le journal est inaccessible), cible appelée sans mutation avec ses arguments d'origine ;
  l'oracle classe `INFRA_ERROR / PROBE_FAILURE` (avant tout autre critère, §18.3-1).
- Rejets non gérés : un crochet `async_hooks` (init) étiquette les promesses créées pendant un appel de
  cible avec son contexte (appel et appels englobants) ; l'écouteur `unhandledRejection` émet
  `UNHANDLED_REJECTION` avec cette attribution ; l'oracle classe `CRASH / UNHANDLED_REJECTION` si le
  rejet vient de l'appel muté ou d'un appel qu'il a fait. Un rejet attendu (`TARGET_REJECT`) est jugé
  comme avant.
- Sous Jest, `process` est une copie dans le contexte `vm` (un écouteur y est sans effet, jest-circus le
  dit). Le transform Jest, qui s'exécute dans le vrai processus, publie `process` sur le module
  `async_hooks` (partagé tel quel avec le contexte vm) ; la sonde s'y abonne à l'enveloppement du
  premier module ciblé (après le `setup` de jest-circus, qui sinon retirerait l'écouteur). Sous Vitest,
  le fichier de setup passe `process` à `install`.
- Si la sonde est seule à écouter, le rejet est relancé (comportement par défaut de Node conservé).

## D-026 — 2026-10-02 — Écarts C.0 régularisés (A-15) et ordre des premiers commits (G-04)

- `fetchUser` non déclarée `async` (D-005) : seule façon de lever SYNCHRONIQUEMENT (`TypeError` pour un
  objet) tout en renvoyant une promesse sinon ; couvert par J0-14 (`tests/j1/j0-via-cli.test.ts`).
- `exitOn("boom")` atteint par l'extension `inputs.values` (D-006) : aucun catalogue du §13.3 ne
  contient `"boom"` ; couvert par J0-9 (même fichier).
- G-04 : le premier commit du dépôt n'est pas `docs/SPEC.md` seul précédé de rien (D-001 : `.gitattributes`
  d'abord). Non corrigeable sans réécrire l'historique (interdit) : constaté, laissé tel quel.

## D-027 — 2026-10-02 — Plan, catalogues, hints, tests non déterministes (A-07, A-08, A-09, A-13, A-14)

- **Plan (A-09)** : `gitCommit` ajouté au plan (`null` hors dépôt). L'empreinte d'environnement n'y est
  PAS : elle varie d'une machine à l'autre et casserait « mêmes (projet, commit, config, graine,
  version) ⇒ même plan, octet pour octet » (§14.3). Déviation motivée du §14.1 : elle reste dans le run,
  le rapport (`reproducibility.envHash`) et la clé de cache. Testé : deux runs d'empreintes
  d'environnement différentes donnent des plans identiques (`packages/engine/test/planning.test.ts`).
- **Catalogues (A-07)** : chaînes `"123"`, `"null"`, `"true"` (stratégie `type`) ; tableaux `[null]`,
  `[""]`, `[1]`, `[1,null,{}]` (stratégie `structure`) ; Map, Set, Buffer : vides et types voisins
  dédiés ; le doublon « é » de `encoding` devient la forme DÉCOMPOSÉE (e + U+0301). Test exhaustif par
  type contre la liste du §13.3 (`packages/core/test/catalogue-spec.test.ts`). Effet : plans plus grands
  pour les chaînes et tableaux (budgets inchangés).
- **Provenance des bornes (A-08)** : chaque mutation `boundary` porte `provenance` (declared / observed /
  universal), jusque dans le plan, la base (données de la mutation) et le rapport. Les bornes
  déclarées/observées sont générées avant les universelles : une valeur commune garde la provenance la
  plus informative.
- **Hints (A-13)** : aligné strictement sur §12.3/§18.4 — `range` ne juge qu'un nombre, `format` qu'une
  chaîne, `length` qu'une chaîne ou un tableau ; un autre type ou un champ supprimé n'est plus une
  `HINT_VIOLATION` (extension J1 retirée ; tests positifs et négatifs).
- **Tests non déterministes (A-14)** : conflit §8.4 (« mutation possible mais fragile ») / J0-2 (« écart
  d'empreinte ⇒ FLAKY »). Choix : J0-2 (normatif, partie C prime) — un test dont les empreintes
  d'arguments diffèrent entre baselines est `FLAKY` (raison `NON_DETERMINISTIC_INPUT`), exclu du fuzz et
  listé dans « non couvert » (tests instables). Muter un appel dont l'empreinte change d'une exécution à
  l'autre donnerait `AMBIGUOUS_CALL_SITE` à coup sûr (J0-13) : la mutation serait de toute façon inopérante.

## D-028 — 2026-10-02 — Configuration, intégrité, référence de comparaison (A-06, B-01, C-02)

- **A-06** : règle « accepté = implémenté » (`docs/notes/configuration.md`). `reset.environment` et
  `reset.mocks` ne valent que `true` (un processus neuf par mutation les réinitialise toujours : `false`
  est refusé plutôt que prétendu) ; `database: command` et `filesystem: tmpdir` implémentés ;
  `filesystem: copy`, `combine: true`, `parallelism ≠ 1`, `isolation ≠ process`,
  `store_raw_values: true` refusés par code (exit 3). `test.env` et `test.cwd`, acceptés mais jamais lus
  jusqu'ici, sont appliqués aux processus de test. `test.command` n'est pas exécutée (Varia lance le
  runner pour injecter la sonde, §5) : elle désigne le framework si `test.framework` est absent.
- **B-01** : `guardProject` encadre baseline, fuzz, rejeu et doctor ; un run qui a modifié le projet est
  marqué `PROJECT_MUTATED` (avec la liste des fichiers) avant l'erreur et n'est plus jamais une référence
  ni une source d'historique (« déjà vue ») ; `-uall` ; `ignore_for_integrity` en mode git ; le stockage
  de Varia dans le projet est exclu de la surveillance. Le rejeu ne modifie pas l'état du run d'origine.
- **C-02** : référence = dernier run `COMPLETED` non partiel ; une issue absente n'est `FIXED` que si
  une de ses mutations a été rejouée, ou si (run complet) sa cible l'a été ; sinon `UNKNOWN`. Même
  exigence de run complet pour la référence de `fail_on_new_only_against`.
