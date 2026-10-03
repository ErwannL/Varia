<?php

declare(strict_types=1);

namespace Varia\Probe\Tests;

use PHPUnit\Framework\TestCase;
use Varia\Probe\Absent;
use Varia\Probe\Json;
use Varia\Probe\Serializer;

final class Prive
{
    public int $a = 1;
    protected string $b = 'b';
    private ?string $password = 'secret-prive';
}

final class SerializerTest extends TestCase
{
    private static function j(mixed $v): string
    {
        return Json::line($v);
    }

    public function testTypesRuntime(): void
    {
        $f = fopen('php://memory', 'r');
        $types = array_map([Serializer::class, 'typeOf'], [
            null, true, 1, PHP_INT_MAX, 1.5, 'é', "\xff", [1], ['a' => 1], Absent::value(),
            new \DateTimeImmutable(), new \Exception(), fn () => 1, new \SplObjectStorage(), new \stdClass(), $f,
        ]);
        fclose($f);
        $this->assertSame(['null', 'boolean', 'number', 'bigint', 'number', 'string', 'bytes', 'array', 'object', 'undefined', 'date', 'error', 'function', 'map', 'object', 'object'], $types);
    }

    public function testValeursParticulieres(): void
    {
        $s = new Serializer();
        $f = fopen('php://memory', 'r');
        $closed = fopen('php://memory', 'r');
        fclose($closed);
        $gen = (fn () => yield 1)();
        $map = new \SplObjectStorage();
        $k = new \stdClass();
        $map[$k] = 'v';
        $this->assertSame(
            '[{"$t":"bytes","kind":"string","base64":"/w=="},{"$t":"bigint","v":"9223372036854775807"},{"$t":"opaque","kind":"function","name":"{closure}"},{"$t":"opaque","kind":"stream"},{"$t":"opaque","kind":"resource"},{"$t":"opaque","kind":"Generator"},{"$t":"map","entries":[[{},"v"]]},{"$t":"number","v":"Infinity"},{"$t":"date","v":"2024-01-01T10:00:00.000Z"}]',
            self::j($s->serializeArgs(["\xff", PHP_INT_MAX, fn () => 1, $f, $closed, $gen, $map, INF, new \DateTime('2024-01-01T12:00:00+02:00')])),
        );
        fclose($f);
    }

    public function testTableTronquee(): void
    {
        $map = new \SplObjectStorage();
        for ($i = 0; $i < 201; $i++) {
            $map[new \stdClass()] = $i;
        }
        $out = (new Serializer())->serialize($map);
        $this->assertCount(200, $out->entries);
    }

    public function testInstanceToutesVisibilitesEtRedaction(): void
    {
        $s = Serializer::fromRedact(['fields' => ['password'], 'hmacKey' => 'k'])->forExport('f');
        $out = self::j($s->serialize(new Prive(), 'arg0'));
        $this->assertStringContainsString('"ctor":"Prive","v":{"a":1,"b":"b","password":{"$redacted":true', $out);
        $this->assertStringNotContainsString('secret-prive', $out);
        $this->assertSame(['secret-prive'], $s->secrets);
    }

    public function testMotifsCheminsEtRetour(): void
    {
        $s = Serializer::fromRedact(['patterns' => ['to/ken$'], 'skipPaths' => ['f#arg1', 'g#arg0'], 'hmacKey' => 'k'])->forExport('f');
        $args = $s->serializeArgs([['ato/ken' => 'x', 'n' => 1], 'secret']);
        $this->assertTrue($args[0]->{'ato/ken'}->{'$redacted'});
        $this->assertTrue($args[1]->{'$redacted'});
        $this->assertSame(['x', 'secret'], $s->secrets);
        // Valeur de retour : aucun chemin masqué, aucun secret collecté.
        $this->assertSame('secret', $s->serializeReturn('secret'));
        $this->assertSame(['x', 'secret'], $s->secrets);
        // Secret imbriqué dans une valeur masquée : collecté aussi.
        $t = Serializer::fromRedact(['fields' => ['creds'], 'patterns' => ['^pass$']])->forExport('f');
        $t->serializeArgs([['creds' => ['pass' => 'p1', 'user' => 'u']]]);
        $this->assertSame(['p1'], $t->secrets);
    }

    public function testErreurs(): void
    {
        $this->assertSame('{"name":"string","message":"","stack":"","constructorChain":[]}', self::j(Serializer::error('x')));
        $e = new class ('m') extends \RuntimeException {
            public mixed $status = 'abc';
        };
        $out = Serializer::error($e);
        $this->assertFalse(property_exists($out, 'status'));
        $this->assertFalse(property_exists($out, 'code'));
        $e2 = new \LogicException('m', 7);
        $this->assertSame('7', Serializer::error($e2)->code);
        $this->assertSame(['LogicException', 'Exception'], Serializer::error($e2)->constructorChain);
        $this->assertStringContainsString('SerializerTest.php', Serializer::error($e2)->stack);
        $this->assertSame('Simple', Serializer::shortName('Simple'));
        // Fichier réécrit : la pile montre le fichier d'origine.
        Serializer::$files[__FILE__] = '/origine/Fichier.php';
        $this->assertStringStartsWith('at /origine/Fichier.php:', Serializer::error(new \Exception())->stack);
        Serializer::$files = [];
    }

    public function testPileSansCadreDeFichier(): void
    {
        try {
            array_map('intdiv', [1], [0]);
        } catch (\DivisionByZeroError $e) {
            $this->assertStringContainsString('[interne]', Serializer::error($e)->stack);
        }
    }
}
