# Sondes Python, PHP et Java (J4)

- **Pytest** : jamais de bytecode écrit (`PYTHONDONTWRITEBYTECODE=1`) — un cache conservé par
  `--keep-tmp` contenait des secrets. pytest échappe les identifiants non ASCII (`Chlo\xe9`) : nom
  gardé tel quel. Module mandataire dans `sys.modules` (pas d'enveloppement des globales, sinon les
  appels internes seraient observés). `sys.exit` ≠ `os._exit`.
- **PHPUnit** : copie réécrite chargée par l'autoload ; une classe chargée avant le bootstrap ou par
  `require` n'est pas observée (`NO_TARGET_MODULE_WRAPPED`). `vendor/` et `composer.lock` des exemples
  hors Prettier. Plan relu en objets (`{}` ≠ `[]`).
- **JUnit** : préparation hors ligne (`mvn -o`) ; rapport Open Test Reporting incomplet ⇒ aucun
  résultat. `target/` hors lint et Prettier (rapport HTML JaCoCo). Les `.class` du projet contiennent
  ses littéraux de test : exclus de la recherche de secrets.
- Outils absents : `npm run examples:install` le signale et continue ; les tests de ces adaptateurs
  échouent (jamais sautés). La CI installe Python 3.11, PHP 8.3 + pcov et Java 21 sur chaque runner.
