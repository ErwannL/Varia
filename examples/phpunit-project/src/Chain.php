<?php

declare(strict_types=1);

namespace App;

/** Appel transitif via une autre classe cible : outer (profondeur 0) puis inner (profondeur 1). */
final class Chain
{
    public function outer(mixed $x): int
    {
        return Text::inner($x);
    }
}
