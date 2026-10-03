<?php

declare(strict_types=1);

namespace App\Tests;

use App\Users;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\TestDox;
use PHPUnit\Framework\TestCase;

final class UsersTest extends TestCase
{
    #[TestDox('createUser crée un utilisateur valide')]
    public function testValide(): void
    {
        $user = Users::createUser(['name' => 'Erwann', 'age' => 25, 'password' => 'hunter2-secret']);
        $this->assertSame('Erwann', $user['name']);
        $this->assertArrayNotHasKey('password', $user);
    }

    #[TestDox('createUser crée trois utilisateurs')]
    public function testTrois(): void
    {
        $a = Users::createUser(['name' => 'Ada', 'age' => 36, 'password' => 'pw-ada-secret']);
        $b = Users::createUser(['name' => 'Grace', 'age' => 45, 'password' => 'pw-grace-secret']);
        $c = Users::createUser(['name' => 'Linus', 'age' => 21, 'password' => 'pw-linus-secret']);
        $this->assertSame(['Ada', 'Grace', 'Linus'], [$a['name'], $b['name'], $c['name']]);
    }

    /** @return array<string, array{string, int}> */
    public static function personnes(): array
    {
        return ['Alice' => ['Alice', 30], 'Bob' => ['Bob', 40], 'Chloé' => ['Chloé', 50]];
    }

    #[DataProvider('personnes')]
    #[TestDox('createUser accepte $name ($age ans)')]
    public function testAccepte(string $name, int $age): void
    {
        $this->assertSame($name, Users::createUser(['name' => $name, 'age' => $age, 'password' => 'pw-each-secret'])['name']);
    }
}
