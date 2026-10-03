<?php

declare(strict_types=1);

namespace App;

final class Users
{
    private static int $nextId = 1;

    /**
     * name absent, null ou vide => ValidationError (HANDLED) ; aucune vérification de type : un
     * tableau, un objet ou un nombre atteint trim() et lève une TypeError (CRASH, strict_types).
     *
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    public static function createUser(array $user): array
    {
        $name = $user['name'] ?? null;
        if ($name === null) {
            throw new ValidationError('name is required');
        }
        if (is_string($name) && trim($name) === '') {
            throw new ValidationError('name is empty');
        }
        return ['id' => self::$nextId++, 'name' => trim($name), 'age' => $user['age'] ?? null];
    }
}
