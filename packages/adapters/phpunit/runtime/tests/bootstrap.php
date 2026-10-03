<?php

declare(strict_types=1);

// Autoload de PHPUnit (`VARIA_PHPUNIT_VENDOR` : vendor/ d'un projet où PHPUnit est installé) puis
// sources de la sonde, sans démarrer la sonde (Boot::start n'est pas appelé).
require getenv('VARIA_PHPUNIT_VENDOR') . '/autoload.php';
foreach (['Json', 'Absent', 'Serializer', 'Mutation', 'Probe', 'Rewriter', 'Loader', 'Extension', 'Boot'] as $f) {
    require_once __DIR__ . "/../src/$f.php";
}
require_once __DIR__ . '/support/Build.php';
