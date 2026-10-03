# CLAUDE.md — règles de travail sur Varia

Spécification : `docs/SPEC.md` (relire à chaque reprise). État : `STATE.md`. Décisions : `DECISIONS.md`.

## Reprise de session

1. Relire `docs/SPEC.md` et `STATE.md`.
2. `npm ci && npm run check` **avant** de croire un état rouge ou vert.
3. Continuer l'étape en cours de `STATE.md`.

## Git

- Travail **direct sur `main`** (prime sur CDC A.2-2). Commit + push à chaque étape vérifiée : `jN: <étape>`.
- Interdits : `push --force`, `reset --hard` sur du poussé, réécriture d'historique, `--no-verify`.
- Push impossible : continuer en local, le noter dans `STATE.md`.

## Principes produit (CDC §2)

Externe ; observer avant de muter ; une mutation = un cas rejouable ; le comportement de la cible
prime sur le statut du test ; déterminisme (mulberry32, jamais `Math.random`) ; isolation (1 mutation
= 1 processus) ; séquentiel par défaut ; honnêteté (dire ce qui n'a pas été observé) ; aucune
modification durable du projet cible ; local, zéro réseau à l'exécution ; une seule écrivaine de la
base (l'orchestrateur) ; la sonde observe, le cœur juge.

## Qualité (non négociable)

- Aucun `.skip/.only/.todo` (contrôlé par `npm run check:skips`), aucun seuil baissé, aucun support simulé
  (`UNSUPPORTED`/`OPAQUE`), chaque test vu échouer une fois.
- Test d'abord ; vérifier avant de déclarer ; invérifiable ⇒ `UNVERIFIED`.
- TS strict, lint 0 avertissement, Prettier épinglé (3.3.3), LF, ≤ 1000 lignes par fichier
  (`npm run check:lines`), un `README.md` par dossier (`npm run check:readmes`).
- Couverture : seuils par fichier versionnés, jamais abaissés.
- Toute règle découverte : `docs/notes/<sujet>.md` + pointeur ici, dans le même commit.
- Textes visibles : clés i18n fr + en ; jamais de texte traduit stocké dans un état.

## Arrêt (seuls cas)

J0 `NO-GO` ; accès extérieur non prévu ; contradiction irréconciliable ; 3 tentatives sans progrès
sans variante dégradée.

## Commandes

```bash
npm run check        # tout
npm run typecheck    # tsc strict
npm run lint         # eslint --max-warnings 0
npm run format:check # prettier épinglé
npm test             # vitest
```

## Notes durables

- `docs/notes/fichiers-longs.md` — exemptions de la limite de 1000 lignes (lockfiles, SPEC).
- `docs/notes/couverture.md` — couverture 100 % par fichier (porte exacte), processus enfants, fichiers `runtime/` testés par `createRequire`.
- `docs/notes/chemins.md` — racine canonique (macOS `/private/var`, noms courts Windows), chemins POSIX dans les tests.
- `docs/notes/sonde-jest.md` — pièges de la sonde sous Jest (instanceof, resetModules, preset, cache, ESM, mocks, `process` vm, sonde défensive).
- `docs/notes/configuration.md` — accepté = implémenté : valeur non implémentée refusée (code `UNSUPPORTED_*`).
- `docs/notes/tests-deterministes.md` — scénarios sans dépendance à la vitesse (cibles déterministes, délais explicites).
- `docs/notes/plateformes.md` — branches de plateforme injectées, tubes asynchrones sous macOS, URL `file:` et shell sous Windows.
- `docs/notes/zero-ia.md` — aucune IA/LLM dans Varia ; contrôle `check:no-ai` (paquets, manifestes, code de sonde).
- `docs/notes/navigateur.md` — mesure en Chromium réel (cibles 44 px, focus) ; navigateur absent = échec sauf `VARIA_BROWSER=absent` déclaré.
- `docs/notes/sonde-mocha.md` — sonde sous Mocha (`--require` + `mochaHooks`, ESM par `module.register`, `spec` concaténé, `--grep` exact).
- `docs/notes/extensions.md` — extensions externes : appel synchrone borné d'un thread (Atomics.wait), terminate des boucles, `import.meta.url` paresseux, `Math.random` par Reflect.
- `docs/notes/sondes-autres-langages.md` — sondes Python, PHP, Java (bytecode et secrets, autoload, agent hors ligne, outils en CI).
