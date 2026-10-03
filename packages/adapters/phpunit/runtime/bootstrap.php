<?php

declare(strict_types=1);

// Bootstrap Varia pour PHPUnit (`--bootstrap`, généré hors du projet) : charge le bootstrap du projet
// (`VARIA_PHPUNIT_BOOTSTRAP`), puis la sonde et son chargeur d'autoload enveloppant.

require __DIR__ . '/src/Json.php';
require __DIR__ . '/src/Absent.php';
require __DIR__ . '/src/Serializer.php';
require __DIR__ . '/src/Mutation.php';
require __DIR__ . '/src/Probe.php';
require __DIR__ . '/src/Rewriter.php';
require __DIR__ . '/src/Loader.php';
require __DIR__ . '/src/Extension.php';
require __DIR__ . '/src/Boot.php';

\Varia\Probe\Boot::start(getenv() ?: [], getmypid() ?: 0);
