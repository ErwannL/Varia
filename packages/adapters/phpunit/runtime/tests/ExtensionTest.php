<?php

declare(strict_types=1);

namespace Varia\Probe\Tests;

use PHPUnit\Event\Code\Phpt;
use PHPUnit\Event\Code\TestMethodBuilder;
use PHPUnit\Event\DirectDispatcher;
use PHPUnit\Event\DispatchingEmitter;
use PHPUnit\Event\Facade as EventFacade;
use PHPUnit\Event\Telemetry;
use PHPUnit\Event\TestSuite\TestSuiteBuilder;
use PHPUnit\Event\TypeMap;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\TestDox;
use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\TestSuite;
use Varia\Probe\Extension;
use Varia\Probe\Probe;

final class ExtensionTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/varia-php-ext-' . bin2hex(random_bytes(4));
        mkdir($this->dir);
        Extension::$results = [];
        Extension::$running = null;
    }

    protected function tearDown(): void
    {
        Probe::activate(null);
        Extension::$exit = null;
        exec('rm -rf ' . escapeshellarg($this->dir));
    }

    /** Émetteur PHPUnit indépendant de celui (scellé) de l'exécution en cours, abonné à l'extension. */
    private function emitter(array $env): DispatchingEmitter
    {
        $map = new TypeMap();
        (new \ReflectionMethod(EventFacade::class, 'registerDefaultTypes'))->invoke(new EventFacade(), $map);
        $d = new DirectDispatcher($map);
        foreach (Extension::subscribers($env) as $s) {
            $d->registerSubscriber($s);
        }
        return new DispatchingEmitter($d, new Telemetry\System(new Telemetry\SystemStopWatch(), new Telemetry\SystemMemoryMeter(), new Telemetry\Php83GarbageCollectorStatusProvider()));
    }

    /** @return array<string, array{int}> */
    public static function lignes(): array
    {
        return ['un' => [1]];
    }

    #[DataProvider('lignes')]
    #[TestDox('cycle de vie $n')]
    public function testCycleDeVieEtResultats(int $n): void
    {
        $p = Probe::init(['VARIA_MODE' => 'observe', 'VARIA_RUN_DIR' => $this->dir], 9);
        Probe::activate($p);
        $e = $this->emitter(['VARIA_PHPUNIT_RESULTS' => "$this->dir/r.json"]);
        $t = TestMethodBuilder::fromTestCase($this);
        $this->assertSame('cycle de vie 1', Extension::nameOf($t));
        $this->assertSame(self::class . '::testCycleDeVieEtResultats with data set "un"', Extension::filterOf($t));
        foreach (['testFailed' => 'failed', 'testErrored' => 'failed', 'testSkipped' => 'skipped', 'testMarkedAsIncomplete' => 'skipped', 'testFinished' => 'passed'] as $event => $status) {
            $e->testPreparationStarted($t);
            match ($event) {
                'testFailed' => $e->testFailed($t, \PHPUnit\Event\Code\ThrowableBuilder::from(new \Exception()), null),
                'testSkipped' => $e->testSkipped($t, 'x'),
                'testFinished' => null,
                default => $e->{$event}($t, \PHPUnit\Event\Code\ThrowableBuilder::from(new \Exception())),
            };
            $e->testFinished($t, 1);
        }
        // Fin sans début, test non méthode (PHPT) : ignorés.
        $e->testFinished($t, 0);
        Extension::status('failed');
        $e->testPreparationStarted(new Phpt(__FILE__));
        $e->testRunnerExecutionFinished();
        $r = json_decode((string) file_get_contents("$this->dir/r.json"), true);
        $this->assertSame(['failed', 'failed', 'skipped', 'skipped', 'passed'], array_column($r, 'status'));
        $this->assertSame('cycle de vie 1', $r[0]['name']);
        // Homonymes : rangs 0 à 4, donc cinq identités distinctes.
        $this->assertCount(5, array_unique(array_column($r, 'testId')));
        $this->assertStringStartsWith('t_', (string) $r[0]['testId']);
        $types = array_column(array_map(fn ($x) => json_decode($x, true), file((string) $p?->logFile) ?: []), 'type');
        $this->assertSame(array_merge(...array_fill(0, 5, ['TEST_START', 'TEST_END'])), $types);
        $this->assertSame($n, 1);
    }

    #[TestDox('sans sonde ni fichier de résultats')]
    public function testSansSonde(): void
    {
        $e = $this->emitter([]);
        $t = TestMethodBuilder::fromTestCase($this);
        $e->testPreparationStarted($t);
        $e->testFinished($t, 0);
        $e->testRunnerExecutionFinished();
        $this->assertNull(Extension::$results[0]['testId']);
        $this->assertSame(self::class . '::testSansSonde', Extension::filterOf($t));
    }

    public function testModeListe(): void
    {
        $exited = false;
        Extension::$exit = function () use (&$exited): void {
            $exited = true;
        };
        $suite = TestSuite::empty('s');
        $suite->addTest($this, []);
        $suite->addTest(new \PHPUnit\Runner\PhptTestCase(__DIR__ . '/fixtures/vide.phpt'), []);
        $e = $this->emitter(['VARIA_PHPUNIT_LIST' => "$this->dir/l.json"]);
        $e->testSuiteLoaded(TestSuiteBuilder::from($suite));
        $this->assertTrue($exited);
        $l = json_decode((string) file_get_contents("$this->dir/l.json"), true);
        $this->assertSame([['file' => __FILE__, 'name' => 'Mode liste', 'filter' => preg_quote(self::class . '::testModeListe', '/')]], $l);
        // Hors mode liste : rien n'est écrit ni arrêté.
        $exited = false;
        $this->emitter([])->testSuiteLoaded(TestSuiteBuilder::from($suite));
        $this->assertFalse($exited);
    }

    public function testBootstrapDeLExtension(): void
    {
        // Façade scellée pendant une exécution : l'enregistrement est refusé par PHPUnit, après l'appel.
        $this->expectException(\PHPUnit\Event\EventFacadeIsSealedException::class);
        (new Extension())->bootstrap(
            \PHPUnit\TextUI\Configuration\Registry::get(),
            new \PHPUnit\Runner\Extension\Facade(),
            \PHPUnit\Runner\Extension\ParameterCollection::fromArray([]),
        );
    }
}
