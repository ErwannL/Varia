<?php

declare(strict_types=1);

namespace Varia\Probe\Tests;

use PHPUnit\Framework\TestCase;
use Varia\Probe\Absent;
use Varia\Probe\Mutation;

final class NonClonable
{
    public int $v = 1;

    private function __clone()
    {
    }
}

#[\AllowDynamicProperties]
final class Champs
{
    public array $liste = [1];
    public readonly int $fixe;
    public ?Champs $self = null;
    public int $nonInit;

    public function __construct()
    {
        $this->fixe = 3;
    }
}

final class MutationTest extends TestCase
{
    /** @param array<string, mixed> $m */
    private static function m(array $path, mixed $value = null, string $op = 'set'): array
    {
        return ['path' => $path, 'op' => $op, 'value' => $value];
    }

    public function testCheminsDeTableaux(): void
    {
        $args = [['name' => 'Ada', 'tags' => ['a', 'b', 'c']], 2];
        $this->assertSame([['name' => null, 'tags' => ['a', 'b', 'c']], 2], Mutation::apply($args, self::m(['0', 'name'])));
        $this->assertSame([['name' => 'Ada', 'tags' => ['a', 'c']], 2], Mutation::apply($args, self::m(['0', 'tags', '1'], null, 'delete')));
        $this->assertSame([['tags' => ['a', 'b', 'c']], 2], Mutation::apply($args, self::m(['0', 'name'], (object) ['$t' => 'undefined'])));
        // Arguments d'origine jamais modifiés.
        $this->assertSame('Ada', $args[0]['name']);
        $this->assertNull(Mutation::apply($args, self::m([])));
        $this->assertNull(Mutation::apply($args, self::m(['0', 'absent', 'x'])));
        $this->assertNull(Mutation::apply($args, self::m(['1', 'x'])));
    }

    public function testArgumentsDePremierNiveauAbsents(): void
    {
        $this->assertSame([1], Mutation::apply([1, 2], self::m(['1'], null, 'delete')));
        $this->assertSame([null, 2], Mutation::apply([1, 2], self::m(['0'], (object) ['$t' => 'undefined'])));
    }

    public function testObjets(): void
    {
        $o = new \stdClass();
        $o->name = 'Ada';
        $o->sub = (object) ['x' => 1];
        $r = Mutation::apply([$o], self::m(['0', 'sub', 'x'], 'y'));
        $this->assertSame('y', $r[0]->sub->x);
        $this->assertSame(1, $o->sub->x);
        $r = Mutation::apply([$o], self::m(['0', 'name'], null, 'delete'));
        $this->assertFalse(property_exists($r[0], 'name'));
        $this->assertNull(Mutation::apply([$o], self::m(['0', 'name', 'x'])));
    }

    public function testCopieProfonde(): void
    {
        $c = new Champs();
        $c->self = $c;
        $c->dyn = [1];
        $f = fn () => 1;
        $nc = new NonClonable();
        $copy = Mutation::deepClone([$c, $f, $nc, Absent::value()]);
        $this->assertNotSame($c, $copy[0]);
        $this->assertSame($copy[0], $copy[0]->self);
        $this->assertSame(3, $copy[0]->fixe);
        $this->assertSame($f, $copy[1]);
        $this->assertSame($nc, $copy[2]);
    }

    public function testReconstruction(): void
    {
        $d = fn (string $json) => Mutation::deserialize(json_decode($json));
        $this->assertNan($d('{"$t":"number","v":"NaN"}'));
        $this->assertSame([INF, -INF, 2.5], [$d('{"$t":"number","v":"Infinity"}'), $d('{"$t":"number","v":"-Infinity"}'), $d('{"$t":"number","v":"2.5"}')]);
        $this->assertSame('-0', (new \Varia\Probe\Serializer())->serialize($d('{"$t":"number","v":"-0"}'))->v);
        $this->assertSame(-9007199254740993, $d('{"$t":"bigint","v":"-9007199254740993"}'));
        $this->assertSame('2020-01-01', $d('{"$t":"date","v":"2020-01-01T00:00:00.000Z"}')->format('Y-m-d'));
        $this->assertNull($d('{"$t":"date","v":null}'));
        $this->assertSame('/a+/i', $d('{"$t":"regexp","source":"a+","flags":"i"}'));
        $this->assertSame([1, 'x'], $d('{"$t":"set","values":[1,"x"]}'));
        $this->assertSame(['a' => 1, 2 => 'b'], $d('{"$t":"map","entries":[["a",1],[2,"b"]]}'));
        $this->assertSame("\x00\xff", $d('{"$t":"bytes","base64":"AP8="}'));
        $this->assertSame('boum', $d('{"$t":"error","name":"E","message":"boum"}')->getMessage());
        $this->assertSame(['$t' => 1], $d('{"$t":"object","v":{"$t":1}}'));
        $this->assertEquals(new \stdClass(), $d('{}'));
        $this->assertSame([['a' => [1]]], $d('[{"a":[1]}]'));
        $this->assertInstanceOf(Absent::class, $d('{"$t":"undefined"}'));
        foreach (['{"$t":"opaque","kind":"x"}', '{"$t":"bigint","v":"123456789012345678901234567890"}', '{"$t":"map","entries":[[{"a":1},1]]}'] as $bad) {
            try {
                $d($bad);
                $this->fail("reconstruit : $bad");
            } catch (\UnexpectedValueException) {
                $this->addToAssertionCount(1);
            }
        }
    }
}
