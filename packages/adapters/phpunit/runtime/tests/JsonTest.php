<?php

declare(strict_types=1);

namespace Varia\Probe\Tests;

use PHPUnit\Framework\TestCase;
use Varia\Probe\Json;

final class JsonTest extends TestCase
{
    public function testNombresEcmascript(): void
    {
        $this->assertSame(
            ['5', '0', '-2.5', '1e+21', '1.5e-7', '1.23e-18', '0.000001', '100000000000000000000', '-1e+21', '12.5'],
            array_map([Json::class, 'number'], [5, -0.0, -2.5, 1e21, 1.5e-7, 123e-20, 0.000001, 1e20, -1e21, 12.5]),
        );
    }

    public function testLigneEtCanonique(): void
    {
        $this->assertSame('{"b":1,"a":[true,false,null,"x/y"]}', Json::line((object) ['b' => 1, 'a' => [true, false, null, 'x/y']]));
        $this->assertSame('{"a":[true],"b":1}', Json::canonical(['b' => 1, 'a' => [true]]));
        $this->assertSame(['1', '01', '4294967295', 'a'], Json::sortKeys(['a', '4294967295', '01', '1']));
        $this->assertSame(3, Json::utf16Length('a🙂'));
    }
}
