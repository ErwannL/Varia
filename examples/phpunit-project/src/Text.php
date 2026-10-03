<?php

declare(strict_types=1);

namespace App;

final class Text
{
    public static function inner(mixed $x): int
    {
        return strlen($x);
    }
}
