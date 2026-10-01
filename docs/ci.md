# CI

J1 : `varia test` renvoie 1 si un statut de `ci.fail_on` (défaut `CRASH`, `TIMEOUT`) apparaît, 0 sinon ;
2 baseline invalide, 3 configuration, 4 infrastructure ou `PROJECT_MUTATED`, 5 sonde non supportée.
Monter `--data-dir` en cache entre jobs. `varia ci` (JUnit, SARIF, nouvelles issues seulement) : J2.
Le dépôt Varia lui-même est vérifié par `.github/workflows/ci.yml` (Linux, macOS, Windows ; Node 20/22).
