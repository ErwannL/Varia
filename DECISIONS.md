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
