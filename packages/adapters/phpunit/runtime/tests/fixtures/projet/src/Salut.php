<?php

declare(strict_types=1);

namespace Fixture\Projet;

final class Salut
{
    public static function bonjour(string $nom): string
    {
        return "Bonjour $nom";
    }
}
