<?php

declare(strict_types=1);

namespace Varia\Probe\Tests;

use PHPUnit\Framework\TestCase;
use Varia\Probe\Boot;
use Varia\Probe\Loader;
use Varia\Probe\Probe;

final class LoaderTest extends TestCase
{
    private const ROOT = __DIR__ . '/fixtures/projet';
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/varia-php-loader-' . bin2hex(random_bytes(4));
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        Probe::activate(null);
        exec('rm -rf ' . escapeshellarg($this->dir));
    }

    private function probe(): Probe
    {
        file_put_contents("$this->dir/targets.json", json_encode(['runId' => 'r', 'projectRoot' => realpath(self::ROOT), 'include' => ['^src/(?:.*/)?[^/]*$'], 'exclude' => ['^src/Exclu\.php$']]));
        $p = Probe::init(['VARIA_MODE' => 'observe', 'VARIA_RUN_DIR' => $this->dir, 'VARIA_TARGETS' => "$this->dir/targets.json"], 3);
        $this->assertNotNull($p);
        return $p;
    }

    private function loader(Probe $p): Loader
    {
        $map = ['Fixture\\Projet\\Salut' => 'Salut', 'Fixture\\Projet\\Casse' => 'Casse', 'Fixture\\Projet\\Exclu' => 'Exclu', 'Ailleurs' => '../bootstrap'];
        return new Loader($p, ['^src/(?:.*/)?[^/]*$'], ['^src/Exclu\.php$'], "$this->dir/cache", fn (string $c) => isset($map[$c]) ? self::ROOT . "/src/{$map[$c]}.php" : null);
    }

    public function testChargeUneCibleReecriteHorsDuProjet(): void
    {
        $p = $this->probe();
        Probe::activate($p);
        $l = $this->loader($p);
        $this->assertFalse($l->load('Inconnue'));
        $this->assertFalse($l->load('Fixture\\Projet\\Exclu'));
        $this->assertTrue($l->load('Fixture\\Projet\\Salut'));
        $this->assertSame('Bonjour Ada', \Fixture\Projet\Salut::bonjour('Ada'));
        // Erreur de la sonde (source illisible) : PROBE_ERROR, classe laissée à Composer.
        $this->assertFalse($l->load('Fixture\\Projet\\Casse'));
        // Fichier hors du projet : jamais réécrit.
        $this->assertFalse((new Loader($p, ['.*'], [], "$this->dir/cache", fn () => __FILE__))->load('X'));
        $types = array_column(array_map(fn ($x) => json_decode($x, true), file($p->logFile) ?: []), 'type');
        $this->assertSame(['DISCOVER', 'OBSERVE_CALL', 'TARGET_RETURN', 'PROBE_ERROR'], $types);
        $this->assertCount(1, glob("$this->dir/cache/*Salut.php") ?: []);
        $this->assertTrue($l->matches('src/a/b.php'));
        $this->assertFalse($l->matches('tests/a.php'));
    }

    public function testFinderComposer(): void
    {
        $find = Loader::composerFinder();
        $this->assertStringEndsWith('TestCase.php', (string) $find(TestCase::class));
        $this->assertNull($find('Classe\\Inexistante'));
    }

    public function testFinderPsr4DuProjet(): void
    {
        $find = Loader::psr4Finder(self::ROOT);
        $this->assertSame(self::ROOT . '/src/Salut.php', $find('Fixture\\Projet\\Salut'));
        $this->assertNull($find('Fixture\\Projet\\Absente'));
        $this->assertNull($find('Autre\\Salut'));
        $this->assertNull(Loader::psr4Finder('/inexistant')('Fixture\\Projet\\Salut'));
        $first = Loader::firstOf(fn () => null, $find);
        $this->assertSame(self::ROOT . '/src/Salut.php', $first('Fixture\\Projet\\Salut'));
        $this->assertNull($first('Rien'));
    }

    public function testBootDemarreLaSondeEtLeChargeur(): void
    {
        $this->assertNull(Boot::start(['VARIA_PHPUNIT_BOOTSTRAP' => self::ROOT . '/bootstrap.php'], 1));
        $this->assertTrue($GLOBALS['varia_projet_bootstrap']);
        $this->probe();
        $before = count(spl_autoload_functions());
        $p = Boot::start(['VARIA_MODE' => 'observe', 'VARIA_RUN_DIR' => $this->dir, 'VARIA_TARGETS' => "$this->dir/targets.json"], 5);
        $fns = spl_autoload_functions();
        $this->assertSame($before + 1, count($fns));
        spl_autoload_unregister($fns[0]);
        $this->assertSame($p, Probe::current());
        $this->assertSame('HELLO', json_decode((string) file_get_contents((string) $p?->logFile), true)['type']);
        // Fichier de cibles illisible : aucune cible, la sonde démarre quand même.
        $q = Boot::start(['VARIA_MODE' => 'observe', 'VARIA_RUN_DIR' => $this->dir, 'VARIA_TARGETS' => "$this->dir/absent.json"], 6);
        spl_autoload_unregister(spl_autoload_functions()[0]);
        $this->assertNotNull($q);
    }
}
