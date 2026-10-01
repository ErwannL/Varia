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
