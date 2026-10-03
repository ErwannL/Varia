# packages/adapters/phpunit/runtime/tests/

Tests PHPUnit de la sonde (lancés par `../../test/runtime.test.ts` avec le PHPUnit de
`examples/phpunit-project`, variable `VARIA_PHPUNIT_VENDOR`). `ConformanceTest.php` rejoue
`packages/probe-protocol/conformance/` ; les cas sans équivalent PHP sont déclarés non rejouables avec
leur raison (et le test vérifie qu'ils échoueraient). `fixtures/` : sources lues comme données.
[`support/`](support/README.md) : construction des entrées.
