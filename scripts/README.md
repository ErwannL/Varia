# scripts/

Outils de développement (jamais exécutés par Varia à l'exécution) :

- `check-skipped-tests.mjs` — échoue si un test est `.skip`/`.only`/`.todo`.
- `check-no-ai.mjs` — échoue sur toute dépendance, clé, hôte ou import lié à une IA/LLM (`docs/notes/zero-ia.md`).
- `check-file-lines.mjs` — échoue si un fichier texte suivi dépasse 1000 lignes.
- `check-readmes.mjs` — échoue si un dossier suivi n'a pas de `README.md`.
- `lib-files.mjs` — liste des fichiers suivis (git).
- `clean.mjs` — supprime les `dist/`. `brand.mjs`, `brand-preview.mjs` — marque.
- `external-projects.mjs`, `fetch-external.mjs`, `acceptance-external.mjs` — projets externes épinglés (A.7).
- `dashboard-check.mjs` — vérification du dashboard dans Chromium.
- `mutation-check.mjs` + `mutation-cases.json` — preuve que les tests peuvent échouer.
- `install-examples.mjs` — dépendances des exemples.
- `check-coverage-ignores.mjs` — échoue sur toute esquive de couverture (`v8/c8/istanbul ignore`, `__coverage__`).
- `coverage.mjs` + `coverage-lib.mjs` + `vitest-coverage-provider.mjs` — mesure de couverture complète
  (processus enfants et fichiers `runtime/` reconvertis), `coverage/coverage-exact.json`.
- `check-coverage-exact.mjs` — porte exacte par fichier contre `coverage-thresholds.json`.
- `coverage-gaps.mjs`, `coverage-ratchet.mjs` — liste de ce qui manque ; montée des seuils (jamais à la baisse).
- `write-schemas.ts` — régénère les schémas JSON publiés (configuration, rapport).
