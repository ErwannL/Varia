<?php

declare(strict_types=1);

namespace Varia\Probe;

/** Démarrage dans le processus PHPUnit : bootstrap du projet, puis sonde et chargeur. */
final class Boot
{
    /** @param array<string, string> $env */
    public static function start(array $env, int $pid): ?Probe
    {
        $project = $env['VARIA_PHPUNIT_BOOTSTRAP'] ?? '';
        if ($project !== '') {
            (static function (string $file): void {
                require_once $file;
            })($project);
        }
        $probe = Probe::init($env, $pid);
        Probe::activate($probe);
        if ($probe === null) {
            return null;
        }
        $probe->hello($pid);
        $setup = json_decode((string) @file_get_contents($env['VARIA_TARGETS'] ?? ''), true);
        $setup = is_array($setup) ? $setup : [];
        (new Loader(
            $probe,
            array_values((array) ($setup['include'] ?? [])),
            array_values((array) ($setup['exclude'] ?? [])),
            ($env['VARIA_RUN_DIR'] ?? '') . DIRECTORY_SEPARATOR . 'varia-php',
            Loader::firstOf(Loader::composerFinder(), Loader::psr4Finder($probe->projectRoot)),
        ))->register();
        return $probe;
    }
}
