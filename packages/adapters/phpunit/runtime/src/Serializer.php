<?php

declare(strict_types=1);

namespace Varia\Probe;

/**
 * Sérialisation étiquetée (norme §5), redaction avant écriture (§7), erreurs (§6), identités et
 * empreintes (§8). Sortie : arbre JSON (stdClass pour les objets, tableaux PHP pour les listes).
 */
final class Serializer
{
    public const MAX_DEPTH = 8;
    public const MAX_STRING = 4096;
    public const MAX_ITEMS = 200;
    private const MAX_SAFE = 9007199254740991;

    /** @var array<string, true> noms de champs masqués, en minuscules */
    public array $fields = [];
    /** @var list<string> motifs PCRE complets (délimités, insensibles à la casse) */
    public array $patterns = [];
    /** @var list<string> chemins `export#chemin` */
    public array $skipPaths = [];
    public string $hmacKey = 'varia';
    /** @var array<string, true> chemins masqués de l'appel courant (`arg0.password`) */
    private array $paths = [];
    /** @var list<string> chaînes brutes masquées pendant l'appel courant */
    public array $secrets = [];
    /** @var array<string, string> copie réécrite ⇒ fichier d'origine (piles d'erreur) */
    public static array $files = [];
    /** @var array<int, true> objets en cours de parcours (références circulaires) */
    private array $seen = [];

    /** @param array<string, mixed> $redact contenu de `VARIA_REDACT` */
    public static function fromRedact(array $redact): self
    {
        $s = new self();
        foreach ((array) ($redact['fields'] ?? []) as $f) {
            $s->fields[strtolower((string) $f)] = true;
        }
        foreach ((array) ($redact['patterns'] ?? []) as $p) {
            $s->patterns[] = '/' . str_replace('/', '\/', (string) $p) . '/iu';
        }
        $s->skipPaths = array_values(array_map('strval', (array) ($redact['skipPaths'] ?? [])));
        $s->hmacKey = (string) ($redact['hmacKey'] ?? 'varia');
        return $s;
    }

    /** Options de l'appel à `$export` : ses chemins `export#…` deviennent des chemins masqués. */
    public function forExport(string $export): self
    {
        $s = clone $this;
        $s->paths = [];
        $s->secrets = [];
        $prefix = $export . '#';
        foreach ($this->skipPaths as $p) {
            if (str_starts_with($p, $prefix)) {
                $s->paths[substr($p, strlen($prefix))] = true;
            }
        }
        return $s;
    }

    /**
     * @param list<mixed> $args
     * @return list<mixed>
     */
    public function serializeArgs(array $args): array
    {
        $out = [];
        foreach (array_values($args) as $i => $a) {
            $out[] = $this->serialize($a, 'arg' . $i);
        }
        return $out;
    }

    public function serialize(mixed $value, string $root = ''): mixed
    {
        if (isset($this->paths[$root])) {
            return $this->redacted($value);
        }
        return $this->ser($value, $root, 0);
    }

    /** Valeur de retour : jamais de chemin masqué ni de collecte de secrets. */
    public function serializeReturn(mixed $value): mixed
    {
        $s = clone $this;
        $s->paths = [];
        $s->secrets = [];
        return $s->ser($value, 'return', 0);
    }

    /** @param list<mixed> $serialized */
    public static function fingerprint(array $serialized): string
    {
        return Json::sha256(Json::canonical($serialized));
    }

    public static function testId(string $file, string $name, int $rank): string
    {
        return 't_' . substr(Json::sha256($file . "\0" . $name . "\0" . $rank), 0, 16);
    }

    public static function callSiteId(string $testId, string $module, string $export, int $depth, int $sequence): string
    {
        return 'c_' . substr(Json::sha256(implode("\0", [$testId, $module, $export, (string) $depth, (string) $sequence])), 0, 16);
    }

    /** Type runtime (norme §5) d'une valeur PHP. */
    public static function typeOf(mixed $v): string
    {
        return match (true) {
            $v === null => 'null',
            is_bool($v) => 'boolean',
            is_int($v) => abs($v) > self::MAX_SAFE ? 'bigint' : 'number',
            is_float($v) => 'number',
            is_string($v) => mb_check_encoding($v, 'UTF-8') ? 'string' : 'bytes',
            is_array($v) => array_is_list($v) ? 'array' : 'object',
            $v instanceof Absent => 'undefined',
            $v instanceof \DateTimeInterface => 'date',
            $v instanceof \Throwable => 'error',
            $v instanceof \Closure => 'function',
            $v instanceof \SplObjectStorage => 'map',
            default => 'object',
        };
    }

    /** Nom court d'une classe (`App\ValidationError` ⇒ `ValidationError`). */
    public static function shortName(string $class): string
    {
        $pos = strrpos($class, '\\');
        return $pos === false ? $class : substr($class, $pos + 1);
    }

    private function ser(mixed $value, string $path, int $depth): mixed
    {
        if (is_string($value)) {
            if (!mb_check_encoding($value, 'UTF-8')) {
                return (object) ['$t' => 'bytes', 'kind' => 'string', 'base64' => base64_encode($value)];
            }
            $len = Json::utf16Length($value);
            return $len > self::MAX_STRING
                ? (object) ['$t' => 'string', 'truncated' => true, 'length' => $len, 'sha256' => Json::sha256($value)]
                : $value;
        }
        if (is_int($value)) {
            return abs($value) > self::MAX_SAFE ? (object) ['$t' => 'bigint', 'v' => (string) $value] : $value;
        }
        if (is_float($value)) {
            return match (true) {
                is_nan($value) => (object) ['$t' => 'number', 'v' => 'NaN'],
                $value === INF => (object) ['$t' => 'number', 'v' => 'Infinity'],
                $value === -INF => (object) ['$t' => 'number', 'v' => '-Infinity'],
                $value === 0.0 && fdiv(1, $value) < 0 => (object) ['$t' => 'number', 'v' => '-0'],
                default => $value,
            };
        }
        if ($value === null || is_bool($value)) {
            return $value;
        }
        if ($value instanceof Absent) {
            return (object) ['$t' => 'undefined'];
        }
        if ($value instanceof \Closure) {
            return (object) ['$t' => 'opaque', 'kind' => 'function', 'name' => self::shortName((new \ReflectionFunction($value))->getName())];
        }
        if (!is_array($value) && !is_object($value)) {
            // Ressource (ouverte ou fermée) : opaque.
            return (object) ['$t' => 'opaque', 'kind' => is_resource($value) ? get_resource_type($value) : 'resource'];
        }
        $id = is_object($value) ? spl_object_id($value) : null;
        if ($id !== null && isset($this->seen[$id])) {
            return (object) ['$t' => 'circular'];
        }
        if ($depth >= self::MAX_DEPTH) {
            return (object) ['$t' => 'truncated', 'type' => self::typeOf($value)];
        }
        if ($id !== null) {
            $this->seen[$id] = true;
        }
        try {
            return $this->container($value, $path, $depth);
        } finally {
            if ($id !== null) {
                unset($this->seen[$id]);
            }
        }
    }

    /** @param array<mixed>|object $value */
    private function container(array|object $value, string $path, int $depth): mixed
    {
        if ($value instanceof \DateTimeInterface) {
            $utc = \DateTimeImmutable::createFromInterface($value)->setTimezone(new \DateTimeZone('UTC'));
            return (object) ['$t' => 'date', 'v' => $utc->format('Y-m-d\TH:i:s.v\Z')];
        }
        if ($value instanceof \Throwable) {
            return (object) ['$t' => 'error', 'name' => self::shortName($value::class), 'message' => $value->getMessage()];
        }
        if ($value instanceof \SplObjectStorage) {
            $entries = [];
            $i = 0;
            foreach ($value as $key) {
                if ($i >= self::MAX_ITEMS) {
                    break;
                }
                $entries[] = [$this->ser($key, "$path.<key$i>", $depth + 1), $this->ser($value[$key], "$path.<value$i>", $depth + 1)];
                $i++;
            }
            return (object) ['$t' => 'map', 'entries' => $entries];
        }
        if ($value instanceof \Generator || $value instanceof \Fiber) {
            return (object) ['$t' => 'opaque', 'kind' => $value::class];
        }
        if (is_array($value) && array_is_list($value)) {
            $out = [];
            foreach (array_slice($value, 0, self::MAX_ITEMS) as $i => $item) {
                $out[] = $this->ser($item, "{$path}[$i]", $depth + 1);
            }
            $n = count($value);
            return $n > self::MAX_ITEMS
                ? (object) ['$t' => 'array', 'truncated' => true, 'length' => $n, 'items' => $out]
                : $out;
        }
        $plain = is_array($value) || $value::class === 'stdClass';
        $fields = new \stdClass();
        foreach (array_slice(self::properties($value), 0, self::MAX_ITEMS, true) as $key => $raw) {
            $key = (string) $key;
            $child = "$path.$key";
            $fields->{$key} = $this->redactedKey($key, $child) ? $this->redacted($raw) : $this->ser($raw, $child, $depth + 1);
        }
        if (!$plain) {
            return (object) ['$t' => 'object', 'ctor' => self::shortName($value::class), 'v' => $fields];
        }
        $escaped = property_exists($fields, '$t') || property_exists($fields, '$redacted');
        return $escaped ? (object) ['$t' => 'object', 'v' => $fields] : $fields;
    }

    /**
     * Champs d'un tableau associatif ou d'un objet (toutes visibilités, noms démêlés).
     *
     * @param array<mixed>|object $value
     * @return array<int|string, mixed>
     */
    public static function properties(array|object $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        $out = [];
        foreach ((array) $value as $k => $v) {
            $k = (string) $k;
            $out[str_starts_with($k, "\0") ? substr($k, (int) strrpos($k, "\0") + 1) : $k] = $v;
        }
        return $out;
    }

    private function redactedKey(string $key, string $path): bool
    {
        if (isset($this->fields[strtolower($key)]) || isset($this->paths[$path])) {
            return true;
        }
        foreach ($this->patterns as $p) {
            if (preg_match($p, $key) === 1) {
                return true;
            }
        }
        return false;
    }

    private function redacted(mixed $raw): \stdClass
    {
        if (is_string($raw) && $raw !== '') {
            $this->secrets[] = $raw;
        }
        $inner = clone $this;
        $inner->fields = [];
        $inner->paths = [];
        $inner->seen = [];
        $fingerprint = hash_hmac('sha256', Json::canonical($inner->ser($raw, '', 0)), $this->hmacKey);
        array_push($this->secrets, ...array_slice($inner->secrets, count($this->secrets)));
        return (object) [
            '$redacted' => true,
            'fingerprint' => $fingerprint,
            'type' => self::typeOf($raw),
        ];
    }

    /**
     * Erreur sérialisée (norme §6) ; ne lève jamais. Les chaînes masquées sont retirées.
     *
     * @param list<string> $secrets
     */
    public static function error(mixed $e, array $secrets = []): \stdClass
    {
        $scrub = function (string $s) use ($secrets): string {
            foreach ($secrets as $x) {
                $s = str_replace($x, '[REDACTED]', $s);
            }
            return $s;
        };
        if (!$e instanceof \Throwable) {
            return (object) ['name' => get_debug_type($e), 'message' => '', 'stack' => '', 'constructorChain' => []];
        }
        $chain = [];
        for ($c = $e::class; $c !== false && count($chain) < 10; $c = get_parent_class($c)) {
            $chain[] = self::shortName($c);
        }
        $out = (object) ['name' => self::shortName($e::class), 'message' => $scrub($e->getMessage())];
        $code = $e->getCode();
        if ($code !== 0 && $code !== '') {
            $out->code = (string) $code;
        }
        $status = self::properties($e)['status'] ?? null;
        if ((is_int($status) || is_float($status)) && is_finite((float) $status)) {
            $out->status = $status;
        }
        $out->stack = $scrub(self::stack($e));
        $out->constructorChain = $chain;
        return $out;
    }

    /** Pile filtrée sans arguments (aucune valeur brute) : sonde et PHPUnit retirés, 15 cadres au plus. */
    private static function stack(\Throwable $e): string
    {
        $frames = ["at {$e->getFile()}:{$e->getLine()}"];
        $origin = fn (string $f) => self::$files[$f] ?? $f;
        $frames[0] = 'at ' . $origin($e->getFile()) . ':' . $e->getLine();
        foreach ($e->getTrace() as $f) {
            $where = isset($f['file']) ? $origin($f['file']) . ':' . ($f['line'] ?? 0) : '[interne]';
            $fn = str_replace('__varia', '', ($f['class'] ?? '') . ($f['type'] ?? '') . $f['function']);
            $frames[] = "at $fn ($where)";
        }
        $kept = array_filter(
            $frames,
            fn (string $l) => !str_contains($l, __DIR__) && !str_contains($l, '/phpunit/phpunit/') && !str_contains($l, 'Varia\\Probe\\'),
        );
        return implode("\n", array_slice(array_values($kept), 0, 15));
    }
}
