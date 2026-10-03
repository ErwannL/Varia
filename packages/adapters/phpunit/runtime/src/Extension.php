<?php

declare(strict_types=1);

namespace Varia\Probe;

use PHPUnit\Event\Code\TestMethod;
use PHPUnit\Event\Test;
use PHPUnit\Event\TestRunner;
use PHPUnit\Event\TestSuite;
use PHPUnit\Runner\Extension\Extension as PhpunitExtension;
use PHPUnit\Runner\Extension\Facade;
use PHPUnit\Runner\Extension\ParameterCollection;
use PHPUnit\TextUI\Configuration\Configuration;

/**
 * Extension PHPUnit (`--extension`, configuration du projet jamais modifiée) : délimite les tests
 * pour la sonde (TEST_START / TEST_END), écrit les résultats en fin d'exécution, et, en mode liste
 * (`VARIA_PHPUNIT_LIST`), écrit la liste des tests chargés puis arrête le processus.
 */
final class Extension implements PhpunitExtension
{
    /** @var list<array<string, mixed>> */
    public static array $results = [];
    /** @var array<string, mixed>|null */
    public static ?array $running = null;
    /** @var (\Closure(): void)|null fin du processus en mode liste (remplaçable en test) */
    public static ?\Closure $exit = null;

    public function bootstrap(Configuration $configuration, Facade $facade, ParameterCollection $parameters): void
    {
        $facade->registerSubscribers(...self::subscribers(getenv() ?: []));
    }

    /**
     * @param array<string, string> $env
     * @return list<\PHPUnit\Event\Subscriber>
     */
    public static function subscribers(array $env): array
    {
        $list = $env['VARIA_PHPUNIT_LIST'] ?? '';
        $resultsFile = $env['VARIA_PHPUNIT_RESULTS'] ?? '';
        return [
            new class ($list) implements TestSuite\LoadedSubscriber {
                public function __construct(private readonly string $list)
                {
                }

                public function notify(TestSuite\Loaded $event): void
                {
                    if ($this->list !== '') {
                        Extension::writeList($event->testSuite()->tests(), $this->list);
                        (Extension::$exit ?? static fn () => exit(0))();
                    }
                }
            },
            new class () implements Test\PreparationStartedSubscriber {
                public function notify(Test\PreparationStarted $event): void
                {
                    Extension::start($event->test());
                }
            },
            new class () implements Test\FailedSubscriber {
                public function notify(Test\Failed $event): void
                {
                    Extension::status('failed');
                }
            },
            new class () implements Test\ErroredSubscriber {
                public function notify(Test\Errored $event): void
                {
                    Extension::status('failed');
                }
            },
            new class () implements Test\SkippedSubscriber {
                public function notify(Test\Skipped $event): void
                {
                    Extension::status('skipped');
                }
            },
            new class () implements Test\MarkedIncompleteSubscriber {
                public function notify(Test\MarkedIncomplete $event): void
                {
                    Extension::status('skipped');
                }
            },
            new class () implements Test\FinishedSubscriber {
                public function notify(Test\Finished $event): void
                {
                    Extension::finish();
                }
            },
            new class ($resultsFile) implements TestRunner\ExecutionFinishedSubscriber {
                public function __construct(private readonly string $file)
                {
                }

                public function notify(TestRunner\ExecutionFinished $event): void
                {
                    Extension::writeResults($this->file);
                }
            },
        ];
    }

    /** Nom complet d'un test : son TestDox (attribut `#[TestDox]`, paramètres substitués). */
    public static function nameOf(TestMethod $t): string
    {
        return $t->testDox()->prettifiedMethodName();
    }

    /** Nom vu par `--filter` (`Classe::méthode with data set "x"`). */
    public static function filterOf(TestMethod $t): string
    {
        $name = $t->className() . '::' . $t->methodName();
        if ($t->testData()->hasDataFromDataProvider()) {
            $set = $t->testData()->dataFromDataProvider()->dataSetName();
            $name .= is_int($set) ? " with data set #$set" : " with data set \"$set\"";
        }
        return $name;
    }

    public static function start(\PHPUnit\Event\Code\Test $test): void
    {
        if (!$test instanceof TestMethod) {
            return;
        }
        $file = $test->file();
        $name = self::nameOf($test);
        self::$running = ['file' => $file, 'name' => $name, 'status' => 'passed', 'started' => hrtime(true)];
        Probe::current()?->testStart($file, $name);
    }

    public static function status(string $status): void
    {
        if (self::$running !== null) {
            self::$running['status'] = $status;
        }
    }

    public static function finish(): void
    {
        $probe = Probe::current();
        if (self::$running === null) {
            return;
        }
        $r = self::$running;
        self::$running = null;
        $test = $probe?->test;
        $probe?->testEnd();
        self::$results[] = [
            'testId' => $test['testId'] ?? null,
            'file' => $r['file'],
            'name' => $r['name'],
            'status' => $r['status'],
            'durationMs' => (hrtime(true) - $r['started']) / 1e6,
        ];
    }

    public static function writeResults(string $file): void
    {
        if ($file !== '') {
            file_put_contents($file, Json::line(array_map(fn ($r) => (object) $r, self::$results)));
        }
    }

    /** @param iterable<\PHPUnit\Event\Code\Test> $tests */
    public static function writeList(iterable $tests, string $file): void
    {
        $out = [];
        foreach ($tests as $t) {
            if ($t instanceof TestMethod) {
                $out[] = (object) ['file' => $t->file(), 'name' => self::nameOf($t), 'filter' => preg_quote(self::filterOf($t), '/')];
            }
        }
        file_put_contents($file, Json::line($out));
    }
}
