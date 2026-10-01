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
