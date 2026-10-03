<?php

declare(strict_types=1);

namespace App;

/** Erreur de validation : classée HANDLED par l'oracle (`oracle.handled_errors`). */
class ValidationError extends \DomainException
{
}
