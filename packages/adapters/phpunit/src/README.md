# packages/adapters/phpunit/src/

`adapter.ts` : `PhpunitAdapter` — détection (`vendor/composer/installed.json`), préparation (cibles et
redaction dans le dossier temporaire du run), exécution supervisée de `php vendor/phpunit/phpunit/phpunit`
avec le bootstrap et l'extension de la sonde, lecture des JSONL et des résultats. `index.ts` : exports.
