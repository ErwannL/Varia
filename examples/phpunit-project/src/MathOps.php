<?php

declare(strict_types=1);

namespace App;

/**
 * Appels internes : `double()` est privée (jamais observée) ; `helper()` est publique mais appelée
 * seulement par `sumLocal()` (observée à la profondeur 1, jamais mutée).
 */
final class MathOps
{
    public static function helper(int $a): int
    {
        return $a * 2;
    }

    public static function sumLocal(int $a, int $b): int
    {
        return self::helper($a) + self::double($b) - $b;
    }

    private static function double(int $b): int
    {
        return $b * 2;
    }
}
