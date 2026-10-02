# CI

`varia test` et `varia ci` renvoient 1 si un statut de `ci.fail_on` (défaut `CRASH`, `TIMEOUT`)
apparaît, 0 sinon ; 2 baseline invalide, 3 configuration, 4 infrastructure ou `PROJECT_MUTATED`,
5 sonde non supportée, 130 interrompu.

`varia ci` écrit JUnit (`--junit`), SARIF (`--sarif`), Markdown (`--markdown`), HTML (`--html`) et JSON
(`--json-out`) ; il accepte `--changed [base]`, `--max-time`, `--max-mutations`, `--seed` et les options
de ciblage (`--test`, `--file`, `--function`, `--strategy`). Sous GitHub Actions
(`GITHUB_ACTIONS=true`), il émet aussi des annotations.

Politique « nouvelles issues seulement » : `ci: { fail_on_new_only_against: main }` dans `varia.yml` —
la référence est le dernier run complet (non partiel, non `PROJECT_MUTATED`) de cette branche, d'où
l'intérêt de conserver le répertoire de données (`--data-dir`) en cache entre exécutions.

Gabarits prêts à copier : [`docs/ci/`](ci/README.md) (GitHub Actions, GitLab CI, Jenkins, Azure
DevOps). Leur structure et leur ligne de commande sont vérifiées par `tests/ci-templates.test.ts` ;
ils n'ont pas été exécutés sur leurs plateformes respectives (`UNVERIFIED`).

Le dépôt Varia lui-même est vérifié par `.github/workflows/ci.yml` (Linux, macOS, Windows ; Node 20/22).
