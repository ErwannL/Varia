<?php

declare(strict_types=1);

namespace Varia\Probe;

/**
 * Chargeur d'autoload enveloppant (stratégie 1) : enregistré EN TÊTE de la pile d'autoload, il
 * demande le fichier de la classe aux chargeurs Composer, et si ce fichier est une cible
 * (`targets.include` / `exclude`, chemin relatif au projet), il charge une copie réécrite (Rewriter)
 * placée dans le dossier du run — jamais dans le projet. Sinon il laisse Composer charger la classe.
 */
final class Loader
{
    /**
     * @param list<string> $include expressions régulières (sources) sur le chemin relatif
     * @param list<string> $exclude
     * @param \Closure(string): ?string $find fichier d'une classe (chargeurs Composer)
     */
    public function __construct(
        private readonly Probe $probe,
        private readonly array $include,
        private readonly array $exclude,
        private readonly string $cacheDir,
        private readonly \Closure $find,
    ) {
    }

    /** Fichier d'une classe selon les chargeurs Composer enregistrés. */
    public static function composerFinder(): \Closure
    {
        return function (string $class): ?string {
            foreach (\Composer\Autoload\ClassLoader::getRegisteredLoaders() as $loader) {
                $file = $loader->findFile($class);
                if (is_string($file)) {
                    return $file;
                }
            }
            return null;
        };
    }

    /**
     * Fichier d'une classe selon les règles PSR-4 du `composer.json` du projet (`autoload` et
     * `autoload-dev`), relatives à la racine du projet : utile quand `vendor/` est un lien vers un
     * autre projet (ses chemins Composer pointent alors ailleurs).
     */
    public static function psr4Finder(string $root): \Closure
    {
        $json = json_decode((string) @file_get_contents($root . '/composer.json'), true);
        $rules = [];
        foreach (['autoload', 'autoload-dev'] as $section) {
            foreach ((array) ($json[$section]['psr-4'] ?? []) as $prefix => $dirs) {
                foreach ((array) $dirs as $dir) {
                    $rules[] = [(string) $prefix, rtrim($root . '/' . $dir, '/')];
                }
            }
        }
        return function (string $class) use ($rules): ?string {
            foreach ($rules as [$prefix, $dir]) {
                $file = $dir . '/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
                if (str_starts_with($class, $prefix) && is_file($file)) {
                    return $file;
                }
            }
            return null;
        };
    }

    /** Premier fichier trouvé par l'un des chercheurs. */
    public static function firstOf(\Closure ...$finders): \Closure
    {
        return function (string $class) use ($finders): ?string {
            foreach ($finders as $find) {
                $file = $find($class);
                if ($file !== null) {
                    return $file;
                }
            }
            return null;
        };
    }

    public function register(): void
    {
        spl_autoload_register($this->load(...), true, true);
    }

    public function matches(string $rel): bool
    {
        $test = fn (string $re) => preg_match('#' . str_replace('#', '\#', $re) . '#u', $rel) === 1;
        return array_filter($this->include, $test) !== [] && array_filter($this->exclude, $test) === [];
    }

    /** Charge (réécrite) la classe si son fichier est une cible ; `true` si chargée ici. */
    public function load(string $class): bool
    {
        $file = ($this->find)($class);
        $real = $file === null ? false : realpath($file);
        if ($real === false) {
            return false;
        }
        $module = Probe::relative($this->probe->projectRoot, $real);
        if ($module === str_replace('\\', '/', $real) || !$this->matches($module)) {
            return false;
        }
        try {
            $rw = new Rewriter((string) file_get_contents($real), $real, $module);
            $code = $rw->rewrite();
            if (!is_dir($this->cacheDir)) {
                mkdir($this->cacheDir, 0o700, true);
            }
            $copy = $this->cacheDir . DIRECTORY_SEPARATOR . sha1($real) . '-' . basename($real);
            file_put_contents($copy, $code);
            Serializer::$files[$copy] = $real;
        } catch (\Throwable $e) {
            // Échec de la sonde : la classe est chargée telle quelle, non observée.
            $this->probe->probeError('wrap', $e, ['module' => $module, 'export' => '*']);
            return false;
        }
        (static function (string $copy): void {
            require $copy;
        })($copy);
        // Un fichier n'est chargé qu'une fois (une classe ne se redéclare pas) : une annonce par module.
        $this->probe->emit('DISCOVER', ['module' => $module, 'wrapped' => $rw->wrapped, 'unsupported' => $rw->unsupported]);
        return true;
    }
}
