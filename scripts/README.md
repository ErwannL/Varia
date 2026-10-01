# scripts/

Outils de développement (jamais exécutés par Varia à l'exécution) :

- `check-skipped-tests.mjs` — échoue si un test est `.skip`/`.only`/`.todo`.
- `check-file-lines.mjs` — échoue si un fichier texte suivi dépasse 1000 lignes.
- `check-readmes.mjs` — échoue si un dossier suivi n'a pas de `README.md`.
- `lib-files.mjs` — liste des fichiers suivis (git).
- `clean.mjs` — supprime les `dist/`. `brand.mjs`, `brand-preview.mjs` — marque.
- `external-projects.mjs`, `fetch-external.mjs`, `acceptance-external.mjs` — projets externes épinglés (A.7).
- `dashboard-check.mjs` — vérification du dashboard dans Chromium.
- `mutation-check.mjs` + `mutation-cases.json` — preuve que les tests peuvent échouer.
- `install-examples.mjs` — dépendances des exemples.
