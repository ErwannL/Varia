# docs/ci

Gabarits d'intégration continue pour `varia ci` (CDC §28) : GitHub Actions, GitLab CI, Jenkins,
Azure DevOps. Chacun installe le projet, conserve le répertoire de données (`--data-dir`) entre
exécutions, lance `varia ci` (JUnit, SARIF, Markdown) et publie les rapports. La politique
« nouvelles issues seulement » se règle dans `varia.yml` : `ci: { fail_on_new_only_against: main }`.

Leur structure est vérifiée par `tests/ci-templates.test.ts` ; seul le gabarit GitHub Actions est
proche de la CI réelle du dépôt. Les autres n'ont pas été exécutés sur leur plateforme : `UNVERIFIED`.
