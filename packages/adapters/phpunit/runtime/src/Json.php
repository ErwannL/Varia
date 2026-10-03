<?php

declare(strict_types=1);

namespace Varia\Probe;

/**
 * JSON du protocole (norme §10) : objets = stdClass, listes = tableaux PHP. Nombres au format
 * ECMAScript (`1.0` ⇒ `1`, `1e21` ⇒ `1e+21`), chaînes échappées comme `JSON.stringify`, clés triées
 * (index entiers d'abord, puis unités de code UTF-16) pour le JSON canonique.
 */
final class Json
{
    private const STRING_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        | JSON_UNESCAPED_LINE_TERMINATORS | JSON_INVALID_UTF8_SUBSTITUTE;

    /** JSON canonique : clés triées, compact (indent 0) ou indenté de 2 espaces. */
    public static function canonical(mixed $v, int $indent = 0): string
    {
        return self::encode($v, true, $indent, '');
    }

    /** Ligne de journal : ordre d'insertion conservé, compact. */
    public static function line(mixed $v): string
    {
        return self::encode($v, false, 0, '');
    }

    public static function sha256(string $s): string
    {
        return hash('sha256', $s);
    }

    private static function encode(mixed $v, bool $sort, int $indent, string $pad): string
    {
        if ($v === null) {
            return 'null';
        }
        if (is_bool($v)) {
            return $v ? 'true' : 'false';
        }
        if (is_int($v) || is_float($v)) {
            return self::number($v);
        }
        if (is_string($v)) {
            return (string) json_encode($v, self::STRING_FLAGS);
        }
        $inner = $pad . str_repeat(' ', $indent);
        $nl = $indent > 0 ? "\n" : '';
        if (is_array($v) && array_is_list($v)) {
            if ($v === []) {
                return '[]';
            }
            $items = array_map(fn ($x) => $inner . self::encode($x, $sort, $indent, $inner), $v);
            return '[' . $nl . implode(',' . $nl, $items) . $nl . $pad . ']';
        }
        $fields = [];
        foreach ((array) $v as $k => $x) {
            $fields[(string) $k] = $x;
        }
        if ($fields === []) {
            return '{}';
        }
        $keys = array_map('strval', array_keys($fields));
        if ($sort) {
            $keys = self::sortKeys($keys);
        }
        $sep = $indent > 0 ? ': ' : ':';
        $items = array_map(
            fn (string $k) => $inner . json_encode($k, self::STRING_FLAGS) . $sep
                . self::encode($fields[$k], $sort, $indent, $inner),
            $keys,
        );
        return '{' . $nl . implode(',' . $nl, $items) . $nl . $pad . '}';
    }

    /**
     * Ordre des propriétés d'ECMAScript : clés « index » (0 à 2^32−2, sans zéro de tête) par valeur,
     * puis les autres par unités de code UTF-16.
     *
     * @param list<string> $keys
     * @return list<string>
     */
    public static function sortKeys(array $keys): array
    {
        $index = [];
        $other = [];
        foreach ($keys as $k) {
            if (preg_match('/^(0|[1-9][0-9]*)$/', $k) === 1 && strlen($k) <= 10 && (int) $k <= 4294967294) {
                $index[] = $k;
            } else {
                $other[] = $k;
            }
        }
        usort($index, fn (string $a, string $b) => (int) $a <=> (int) $b);
        usort($other, fn (string $a, string $b) => strcmp(self::utf16($a), self::utf16($b)));
        return array_merge($index, $other);
    }

    /** Octets UTF-16BE : leur ordre binaire est l'ordre des unités de code. */
    public static function utf16(string $s): string
    {
        return (string) mb_convert_encoding($s, 'UTF-16BE', 'UTF-8');
    }

    /** Longueur en unités de code UTF-16 (plafond des chaînes, norme §5). */
    public static function utf16Length(string $s): int
    {
        return intdiv(strlen(self::utf16($s)), 2);
    }

    /** `Number.prototype.toString` d'ECMAScript (NaN et infinis sont étiquetés avant d'arriver ici). */
    public static function number(int|float $n): string
    {
        if (is_int($n)) {
            return (string) $n;
        }
        if ($n == 0.0) {
            return '0';
        }
        $previous = ini_set('serialize_precision', '-1');
        $repr = var_export(abs($n), true);
        ini_set('serialize_precision', (string) $previous);
        preg_match('/^(\d+)(?:\.(\d+))?(?:E([+-]?\d+))?$/i', $repr, $m);
        $digits = $m[1] . ($m[2] ?? '');
        $point = strlen($m[1]) + (int) ($m[3] ?? '0');
        $trimmed = ltrim($digits, '0');
        $point -= strlen($digits) - strlen($trimmed);
        $digits = rtrim($trimmed, '0');
        $k = strlen($digits);
        $sign = $n < 0 ? '-' : '';
        if ($k <= $point && $point <= 21) {
            return $sign . $digits . str_repeat('0', $point - $k);
        }
        if (0 < $point && $point <= 21) {
            return $sign . substr($digits, 0, $point) . '.' . substr($digits, $point);
        }
        if (-6 < $point && $point <= 0) {
            return $sign . '0.' . str_repeat('0', -$point) . $digits;
        }
        $e = $point - 1;
        $exp = 'e' . ($e < 0 ? '-' : '+') . abs($e);
        return $sign . ($k === 1 ? $digits : $digits[0] . '.' . substr($digits, 1)) . $exp;
    }
}
