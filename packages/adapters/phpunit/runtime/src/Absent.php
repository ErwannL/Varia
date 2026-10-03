<?php

declare(strict_types=1);

namespace Varia\Probe;

/**
 * Valeur « absente » (norme §5 : `{"$t":"undefined"}`). PHP n'a pas d'`undefined` : cette sentinelle
 * n'apparaît que dans une mutation (argument omis, clé retirée) ou dans le rejeu de conformité.
 */
final class Absent
{
    private static ?self $instance = null;

    private function __construct()
    {
    }

    public static function value(): self
    {
        return self::$instance ??= new self();
    }
}
