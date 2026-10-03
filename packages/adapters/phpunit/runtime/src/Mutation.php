<?php

declare(strict_types=1);

namespace Varia\Probe;

/**
 * Application d'UNE mutation du plan sur une copie profonde des arguments (norme §9), et
 * reconstruction d'une valeur étiquetée en valeur PHP.
 */
final class Mutation
{
    /**
     * Copie des arguments mutée, ou `null` si le chemin n'existe pas. Un argument de premier niveau
     * rendu « absent » est omis s'il est en fin de liste (les défauts PHP s'appliquent), `null` sinon ;
     * une clé imbriquée rendue « absente » est retirée.
     *
     * @param list<mixed> $args
     * @param array<string, mixed> $m
     * @return list<mixed>|null
     */
    public static function apply(array $args, array $m): ?array
    {
        $copy = self::deepClone($args);
        $path = array_values(array_map('strval', (array) ($m['path'] ?? [])));
        if ($path === []) {
            return null;
        }
        $last = (string) array_pop($path);
        $parent = &$copy;
        foreach ($path as $seg) {
            if (is_array($parent) && array_key_exists($seg, $parent)) {
                $parent = &$parent[$seg];
            } elseif (is_object($parent) && array_key_exists($seg, get_object_vars($parent))) {
                $parent = &$parent->{$seg};
            } else {
                return null;
            }
        }
        $value = ($m['op'] ?? 'set') === 'delete' ? Absent::value() : self::deserialize($m['value'] ?? null);
        if ($path === []) {
            // Argument de premier niveau : la sentinelle est résolue par topLevel().
            $parent[$last] = $value;
        } elseif (is_array($parent)) {
            $value instanceof Absent ? self::unsetKey($parent, $last) : $parent[$last] = $value;
        } elseif (is_object($parent)) {
            if ($value instanceof Absent) {
                unset($parent->{$last});
            } else {
                $parent->{$last} = $value;
            }
        } else {
            return null;
        }
        unset($parent);
        return self::topLevel($copy);
    }

    /** @param array<mixed> $a */
    private static function unsetKey(array &$a, string $key): void
    {
        $list = array_is_list($a);
        unset($a[$key]);
        // Liste : les éléments suivants sont décalés (comme un trou retiré), la liste reste une liste.
        if ($list) {
            $a = array_values($a);
        }
    }

    /**
     * @param array<mixed> $args
     * @return list<mixed>
     */
    private static function topLevel(array $args): array
    {
        $args = array_values($args);
        while ($args !== [] && end($args) instanceof Absent) {
            array_pop($args);
        }
        return array_map(fn ($a) => $a instanceof Absent ? null : $a, $args);
    }

    /** Copie profonde : tableaux et objets (propriétés comprises) ; fermetures et ressources partagées. */
    public static function deepClone(mixed $v, ?\SplObjectStorage $seen = null): mixed
    {
        $seen ??= new \SplObjectStorage();
        if (is_array($v)) {
            return array_map(fn ($x) => self::deepClone($x, $seen), $v);
        }
        if (!is_object($v) || $v instanceof \Closure || $v instanceof \Generator || $v instanceof \Fiber || $v instanceof \UnitEnum || $v instanceof Absent) {
            return $v;
        }
        if ($seen->contains($v)) {
            return $seen[$v];
        }
        $ref = new \ReflectionObject($v);
        if (!$ref->isCloneable()) {
            return $v;
        }
        $copy = clone $v;
        $seen[$v] = $copy;
        // ReflectionObject liste aussi les propriétés dynamiques.
        foreach ($ref->getProperties() as $p) {
            if ($p->isStatic() || !$p->isInitialized($v) || $p->isReadOnly()) {
                continue;
            }
            $p->setValue($copy, self::deepClone($p->getValue($v), $seen));
        }
        return $copy;
    }

    /** Valeur PHP depuis sa forme étiquetée (objets JSON = stdClass). */
    public static function deserialize(mixed $json): mixed
    {
        if (is_array($json)) {
            return array_map([self::class, 'deserialize'], $json);
        }
        if (!$json instanceof \stdClass) {
            return $json;
        }
        $f = get_object_vars($json);
        return match ($f['$t'] ?? null) {
            null => self::fields($f),
            'undefined' => Absent::value(),
            'number' => match ($f['v']) {
                'NaN' => NAN,
                'Infinity' => INF,
                '-Infinity' => -INF,
                '-0' => -0.0,
                default => (float) $f['v'],
            },
            'bigint' => self::bigint((string) $f['v']),
            'date' => $f['v'] === null ? null : new \DateTimeImmutable((string) $f['v']),
            // PHP n'a ni expression régulière, ni ensemble, ni table à clés quelconques natifs.
            'regexp' => '/' . $f['source'] . '/' . $f['flags'],
            'set' => array_map([self::class, 'deserialize'], (array) $f['values']),
            'map' => self::map((array) $f['entries']),
            'bytes' => base64_decode((string) $f['base64']),
            'error' => new \Exception((string) $f['message']),
            'object' => self::fields(get_object_vars($f['v'])),
            default => throw new \UnexpectedValueException('valeur non reconstructible : ' . (string) $f['$t']),
        };
    }

    /**
     * Objet JSON ⇒ tableau associatif ; objet vide ⇒ `stdClass` (un tableau vide serait une liste).
     *
     * @param array<string, mixed> $fields
     * @return array<mixed>|\stdClass
     */
    private static function fields(array $fields): array|\stdClass
    {
        return $fields === [] ? new \stdClass() : array_map([self::class, 'deserialize'], $fields);
    }

    private static function bigint(string $v): int
    {
        if ((string) (int) $v !== $v) {
            throw new \UnexpectedValueException("entier hors de l'intervalle de PHP : $v");
        }
        return (int) $v;
    }

    /** @param list<mixed> $entries @return array<mixed> */
    private static function map(array $entries): array
    {
        $out = [];
        foreach ($entries as $e) {
            $k = self::deserialize($e[0]);
            if (!is_int($k) && !is_string($k)) {
                throw new \UnexpectedValueException('clé de table non scalaire');
            }
            $out[$k] = self::deserialize($e[1]);
        }
        return $out;
    }
}
