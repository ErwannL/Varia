<?php

declare(strict_types=1);

namespace App;

final class Values
{
    /** Renvoie l'argument tel quel, sans validation (ECHO). */
    public static function echoValue(mixed $x): array
    {
        return ['received' => $x];
    }

    /** Termine pour un entier >= 0 ; boucle indéfiniment pour un négatif, un décimal, null. */
    public static function repeat(string $label, mixed $count): string
    {
        $n = $count;
        while ($n !== 0) {
            $n--;
        }
        return $label;
    }

    /** Quitte le processus pour la valeur « boom ». */
    public static function exitOn(mixed $flag): mixed
    {
        if ($flag === 'boom') {
            exit(1);
        }
        return $flag;
    }

    /** Non déterministe. */
    public static function stamp(string $label): string
    {
        return $label . ':' . hrtime(true);
    }
}
