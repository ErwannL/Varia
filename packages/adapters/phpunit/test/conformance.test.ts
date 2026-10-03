// Suite de conformité d'adapter (CDC §9.3) contre l'adapter PHPUnit RÉEL, sur un projet jetable
// construit à partir de examples/phpunit-project (PHPUnit installé, `vendor/` lié). Dialecte PHP : mêmes
// cibles (méthodes statiques d'une classe), mêmes noms de tests (TestDox), test paramétré par
// dataProvider. PHP est synchrone : la vérification `async` ne peut pas passer (NOT FEASIBLE, dit).
import { runConformance } from '@varia/adapter-conformance'
import { PhpunitAdapter } from '@varia/adapter-phpunit'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const TARGET = `<?php

declare(strict_types=1);

namespace App;

class ConformanceError extends \\Exception
{
}

final class Conformance
{
    public static function greet(array $user): string
    {
        return 'Hello ' . $user['name'];
    }

    /** PHP n'a pas de promesse : appel synchrone (aucun TARGET_RETURN async possible). */
    public static function fetchLater(int $id): array
    {
        return ['id' => $id];
    }

    public static function add(int $a, int $b): int
    {
        return $a + $b;
    }

    public static function fail(string $message): never
    {
        throw new ConformanceError($message);
    }

    public static function double(int $n): int
    {
        return $n * 2;
    }
}
`

const TEST = `<?php

declare(strict_types=1);

namespace App\\Tests;

use App\\Conformance;
use App\\ConformanceError;
use PHPUnit\\Framework\\Attributes\\DataProvider;
use PHPUnit\\Framework\\Attributes\\TestDox;
use PHPUnit\\Framework\\TestCase;

final class ConformanceTest extends TestCase
{
    #[TestDox('conformance observe')]
    public function testObserve(): void
    {
        $this->assertSame('Hello Ada', Conformance::greet(['name' => 'Ada']));
    }

    #[TestDox('conformance async')]
    public function testAsync(): void
    {
        $this->assertSame(['id' => 7], Conformance::fetchLater(7));
    }

    #[TestDox('conformance multiple')]
    public function testMultiple(): void
    {
        $this->assertSame([3, 7, 11], [Conformance::add(1, 2), Conformance::add(3, 4), Conformance::add(5, 6)]);
    }

    #[TestDox('conformance throw')]
    public function testThrow(): void
    {
        $this->expectException(ConformanceError::class);
        $this->expectExceptionMessage('refus');
        Conformance::fail('refus');
    }

    public static function rows(): array
    {
        return [[1], [2]];
    }

    #[DataProvider('rows')]
    #[TestDox('conformance param $n')]
    public function testParam(int $n): void
    {
        $this->assertSame($n * 2, Conformance::double($n));
    }
}
`

describe('conformité de l’adapter PHPUnit', () => {
  it('toutes les vérifications passent, sauf `async` (PHP synchrone : NOT FEASIBLE)', async () => {
    const r = await runConformance({
      adapter: new PhpunitAdapter(),
      example: resolve('examples/phpunit-project'),
      dialect: {
        module: 'cjs',
        ext: 'php',
        link: 'vendor',
        baseError: 'Exception',
        files: { 'src/Conformance.php': TARGET, 'tests/ConformanceTest.php': TEST },
      },
    })
    expect(r.checks).toHaveLength(9)
    expect(r.checks.filter((c) => c.status !== 'PASS').map((c) => [c.id, c.status])).toEqual([
      ['async', 'FAIL'],
    ])
    // Échec attendu pour la bonne raison : appel observé, retour synchrone (async: false).
    expect(r.checks.find((c) => c.id === 'async')?.detail).toBe('fetchLater : [{"id":7}]')
  }, 300_000)
})
