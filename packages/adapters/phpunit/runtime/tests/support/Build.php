<?php

declare(strict_types=1);

namespace Varia\Probe\Tests;

use Varia\Probe\Absent;

/** Construction des valeurs PHP depuis le vocabulaire `$in` du jeu de conformité. */
final class Build
{
    public static function value(mixed $in, ?object $self = null): mixed
    {
        if (is_array($in)) {
            return array_map(fn ($x) => self::value($x, $self), $in);
        }
        if (!$in instanceof \stdClass) {
            return $in;
        }
        $kind = $in->{'$in'} ?? null;
        if (is_string($kind) && count(get_object_vars($in)) > 1 || $kind === 'undefined' || $kind === 'self') {
            return self::tagged($in, $self);
        }
        return self::fields(get_object_vars($in));
    }

    /**
     * Objet simple : tableau associatif, sauf s'il serait une liste (vide, clés 0..n) ou s'il contient
     * une référence à lui-même : `stdClass` (seuls les objets ont une identité).
     *
     * @param array<string, mixed> $entries
     */
    private static function fields(array $entries): mixed
    {
        $circular = array_filter($entries, fn ($v) => $v instanceof \stdClass && ($v->{'$in'} ?? null) === 'self') !== [];
        if ($circular || $entries === [] || array_is_list($entries)) {
            $o = new \stdClass();
            foreach ($entries as $k => $v) {
                $o->{$k} = self::value($v, $o);
            }
            return $o;
        }
        return array_map(fn ($v) => self::value($v), $entries);
    }

    private static function tagged(\stdClass $in, ?object $self): mixed
    {
        switch ($in->{'$in'}) {
            case 'undefined':
                return Absent::value();
            case 'self':
                return $self;
            case 'object':
                $e = [];
                foreach ($in->entries as [$k, $v]) {
                    $e[$k] = $v;
                }
                return self::fields($e);
            case 'instance':
                $class = self::declare($in->class, '#[\AllowDynamicProperties] class %s {}');
                $o = new $class();
                foreach ($in->entries as [$k, $v]) {
                    $o->{$k} = self::value($v);
                }
                return $o;
            case 'number':
                return ['NaN' => NAN, 'Infinity' => INF, '-Infinity' => -INF, '-0' => -0.0][$in->v];
            case 'bigint':
                // Hors de int64 : non représentable (cas déclaré non applicable) ; sinon un int PHP.
                return (string) (int) $in->v === $in->v ? (int) $in->v : $in->v;
            case 'date':
                return new \DateTimeImmutable($in->v);
            case 'map':
                $m = [];
                foreach ($in->entries as [$k, $v]) {
                    $m[$k] = self::value($v);
                }
                return $m;
            case 'set':
                return array_map(fn ($v) => self::value($v), $in->values);
            case 'bytes':
                return base64_decode($in->base64);
            case 'error':
                return self::error($in);
            case 'function':
                $fn = 'Varia\\Probe\\Tests\\Fixture\\' . $in->name;
                if (!function_exists($fn)) {
                    eval("namespace Varia\\Probe\\Tests\\Fixture; function {$in->name}() {}");
                }
                return $fn(...);
            case 'string':
                return str_repeat($in->repeat, $in->times);
            case 'array':
                return array_fill(0, $in->times, self::value($in->repeat));
            default:
                $leaf = self::value($in->leaf);
                for ($i = 0; $i < $in->depth; $i++) {
                    $leaf = [$in->key => $leaf];
                }
                return $leaf;
        }
    }

    /** Classe de test déclarée une fois dans un espace de noms dédié. */
    private static function declare(string $name, string $template): string
    {
        $fqcn = 'Varia\\Probe\\Tests\\Fixture\\' . $name;
        if (!class_exists($fqcn, false)) {
            eval('namespace Varia\\Probe\\Tests\\Fixture; ' . sprintf($template, $name));
        }
        return $fqcn;
    }

    private static function error(\stdClass $in): \Throwable
    {
        $chain = array_reverse($in->chain ?? []);
        $parent = '\\Exception';
        foreach ($chain as $c) {
            $parent = '\\' . self::declare($c, "class %s extends $parent { public \$status; }");
        }
        $e = new $parent($in->message);
        if (isset($in->code)) {
            (new \ReflectionProperty(\Exception::class, 'code'))->setValue($e, $in->code);
        }
        if (isset($in->status)) {
            $e->status = $in->status;
        }
        return $e;
    }
}
