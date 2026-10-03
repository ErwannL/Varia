<?php

declare(strict_types=1);

namespace Varia\Probe\Tests;

use PHPUnit\Framework\TestCase;
use Varia\Probe\Probe;
use Varia\Probe\Rewriter;

final class RewriterTest extends TestCase
{
    private static string $dir;

    public static function setUpBeforeClass(): void
    {
        self::$dir = sys_get_temp_dir() . '/varia-php-rw-' . bin2hex(random_bytes(4));
        mkdir(self::$dir);
    }

    /** Réécriture faite dans un test (mesurée par la couverture), une fois. */
    private static function load(): array
    {
        if (!isset($GLOBALS['varia_rw'])) {
            $src = __DIR__ . '/fixtures/Cibles.php';
            $rw = new Rewriter((string) file_get_contents($src), $src, 'tests/fixtures/Cibles.php');
            $code = $rw->rewrite();
            file_put_contents(self::$dir . '/copie.php', $code);
            $GLOBALS['varia_rw'] = [$rw->wrapped, $rw->unsupported, $code];
            require self::$dir . '/copie.php';
        }
        return $GLOBALS['varia_rw'];
    }

    public static function tearDownAfterClass(): void
    {
        array_map('unlink', glob(self::$dir . '/*') ?: []);
        rmdir(self::$dir);
        Probe::activate(null);
    }

    public function testMethodesEnveloppeesEtNonEnveloppables(): void
    {
        [$wrapped, $unsupported, $code] = self::load();
        $this->assertSame(['aire', 'nom', 'creer', 'oublier', 'anonyme'], $wrapped);
        $this->assertSame(['reference', 'ajouter'], $unsupported);
        // Lignes conservées : même nombre de lignes que l'original.
        $this->assertSame(substr_count((string) file_get_contents(__DIR__ . '/fixtures/Cibles.php'), "\n"), substr_count($code, "\n"));
    }

    public function testComportementConserveEtObserve(): void
    {
        self::load();
        $p = Probe::init(['VARIA_MODE' => 'observe', 'VARIA_RUN_DIR' => self::$dir], 7);
        Probe::activate($p);
        $c = \Fixture\Cibles\Carre::creer(3.0);
        $this->assertSame(9.0, $c->aire());
        $this->assertSame('carré 3 nom Fixture\Cibles\Carre::nom fixtures Cibles.php', $c->nom());
        $c->oublier();
        $this->assertSame(1, $c->anonyme()->f());
        $this->assertSame(\Fixture\Cibles\Carre::NOMS, ['a' => '{', 'b' => '}']);
        $l = array_map(fn ($x) => json_decode($x, true), file((string) $p?->logFile) ?: []);
        $calls = array_values(array_filter($l, fn ($x) => $x['type'] === 'OBSERVE_CALL'));
        $this->assertSame(['creer', 'aire', 'nom', 'oublier', 'anonyme'], array_column($calls, 'export'));
        $this->assertSame([[3], []], [$calls[0]['args'], $calls[1]['args']]);
        $this->assertSame('tests/fixtures/Cibles.php', $calls[0]['module']);
    }

    public function testAccoladeNonFermee(): void
    {
        $this->expectException(\ParseError::class);
        (new Rewriter('<?php class A { public function f() { ', 'a.php', 'a.php'))->rewrite();
    }

    public function testSansEspaceDeNoms(): void
    {
        $rw = new Rewriter('<?php echo Foo::class; class B { public function g() { return 1; } }', '/x/b.php', 'b.php');
        $this->assertStringContainsString("Probe::call('b.php', 'g'", $rw->rewrite());
        $this->assertSame(['g'], $rw->wrapped);
    }
}
