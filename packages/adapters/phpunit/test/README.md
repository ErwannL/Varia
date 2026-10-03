# packages/adapters/phpunit/test/

- `adapter.test.ts` — fonctions pures et exécutions réelles sur `examples/phpunit-project`.
- `conformance.test.ts` — suite de conformité d'adapter (dialecte PHP) ; `async` échoue (PHP synchrone).
- `runtime.test.ts` — tests PHPUnit de la sonde PHP (dont le rejeu du jeu de conformité du protocole),
  couverture pcov : échoue sous 100 % des lignes de `runtime/src`.

Prérequis : `php` (8.2+) avec l'extension `pcov`, et `npm run examples:install` (Composer).
