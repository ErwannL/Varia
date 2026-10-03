<?php

declare(strict_types=1);

namespace App\Tests;

use App\Chain;
use App\MathOps;
use App\Values;
use PHPUnit\Framework\Attributes\TestDox;
use PHPUnit\Framework\TestCase;

final class ValuesTest extends TestCase
{
    #[TestDox('echoValue renvoie sa valeur')]
    public function testEcho(): void
    {
        $this->assertSame(['received' => 'abc'], Values::echoValue('abc'));
    }

    #[TestDox('echoValue renvoie un horodatage')]
    public function testHorodatage(): void
    {
        $this->assertNotSame('', Values::echoValue(Values::stamp('t'))['received']);
    }

    #[TestDox('repeat termine pour un compteur positif')]
    public function testRepeat(): void
    {
        $this->assertSame('x', Values::repeat('x', 3));
    }

    #[TestDox('exitOn renvoie son drapeau')]
    public function testExit(): void
    {
        $this->assertSame('ok', Values::exitOn('ok'));
    }

    #[TestDox('outer appelle inner (profondeurs 0 et 1)')]
    public function testChain(): void
    {
        $this->assertSame(3, (new Chain())->outer('abc'));
        $this->assertSame(2, (new Chain())->outer('ab'));
    }

    #[TestDox('sumLocal appelle des méthodes internes')]
    public function testSum(): void
    {
        $this->assertSame(7, MathOps::sumLocal(2, 3));
    }
}
