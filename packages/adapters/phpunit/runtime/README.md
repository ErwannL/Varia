# packages/adapters/phpunit/runtime/

Sonde PHP (norme `docs/probe-protocol.md`, version 1.2), exécutée dans le processus PHPUnit.

- `bootstrap.php` — passé à `--bootstrap` : charge le bootstrap du projet (`VARIA_PHPUNIT_BOOTSTRAP`),
  puis la sonde et son chargeur d'autoload.
- [`src/`](src/README.md) — classes de la sonde (espace de noms `Varia\Probe`).
- [`tests/`](tests/README.md) — tests PHPUnit de la sonde ; `phpunit.xml` les configure.
