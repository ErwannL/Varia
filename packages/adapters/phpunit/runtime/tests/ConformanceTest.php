<?php

declare(strict_types=1);

namespace Varia\Probe\Tests;

use PHPUnit\Framework\TestCase;
use Varia\Probe\Json;
use Varia\Probe\Serializer;

/**
 * Rejeu du jeu de conformité du protocole (packages/probe-protocol/conformance) par la sonde PHP.
 * Un cas sans équivalent PHP est déclaré NON REJOUABLE avec sa raison, jamais compté réussi.
 */
final class ConformanceTest extends TestCase
{
    private const DIR = __DIR__ . '/../../../../probe-protocol/conformance';

    /** Cas sans équivalent en PHP (raison). */
    public const NOT_APPLICABLE = [
        'values/bigint' => 'entier hors de int64 : PHP n\'a pas d\'entier arbitraire natif (GMP absent)',
        'values/map' => 'table à clé non textuelle : un array PHP convertit la clé 1 en index (objet), Ds\\Map absent',
        'values/set' => 'PHP n\'a pas d\'ensemble natif (Ds\\Set absent)',
        'values/bytes-vide' => 'une chaîne binaire vide est la chaîne vide (UTF-8 valide) : indiscernable',
        'objects/circulaire-tableau' => 'un array PHP est une valeur : cycle seulement par référence &, sans identité observable',
        'redaction/cle-de-map' => 'une table à clés textuelles est un array associatif PHP, sérialisé en objet (règle couverte par redaction/champ)',
    ];

    /** @return array<string, array{\stdClass}> */
    public static function cases(): array
    {
        $manifest = json_decode((string) file_get_contents(self::DIR . '/manifest.json'));
        $out = [];
        foreach ($manifest->files as $f) {
            foreach (json_decode((string) file_get_contents(self::DIR . "/cases/$f"))->cases as $c) {
                $out[$c->id] = [$c];
            }
        }
        return $out;
    }

    public function testManifesteEnVersion12(): void
    {
        $this->assertSame('1.2', json_decode((string) file_get_contents(self::DIR . '/manifest.json'))->protocolVersion);
        $ids = array_keys(self::cases());
        // Chaque cas non rejouable existe (une liste périmée échoue).
        $this->assertSame([], array_values(array_diff(array_keys(self::NOT_APPLICABLE), $ids)));
        $this->assertGreaterThan(50, count($ids));
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('cases')]
    public function testCas(\stdClass $c): void
    {
        if (isset(self::NOT_APPLICABLE[$c->id])) {
            // Non rejouable : on vérifie qu'il ÉCHOUERAIT bien (sinon la déclaration serait fausse).
            $this->assertFalse(self::same(self::execute($c), $c->expected), "$c->id rejoué alors que déclaré non applicable");
            return;
        }
        $got = self::execute($c);
        $this->assertTrue(self::same($got, $c->expected), $c->id . ' : ' . Json::line($got) . ' ≠ ' . Json::line($c->expected));
    }

    public static function execute(\stdClass $c): mixed
    {
        $in = $c->input;
        switch ($c->op) {
            case 'serialize':
                return (new Serializer())->serialize(Build::value($in->value));
            case 'serializeArgs':
                $s = Serializer::fromRedact(json_decode((string) json_encode($in->redact ?? new \stdClass()), true))->forExport($in->export ?? 'f');
                $args = $s->serializeArgs(array_map([Build::class, 'value'], $in->args));
                return (object) ['args' => $args, 'argsFingerprint' => Serializer::fingerprint($args)];
            case 'serializeError':
                $s = Serializer::fromRedact(json_decode((string) json_encode($in->redact ?? new \stdClass()), true))->forExport($in->export ?? 'f');
                $s->serializeArgs(array_map([Build::class, 'value'], $in->args ?? []));
                return Serializer::error(Build::value($in->error), $s->secrets);
            case 'testId':
                return Serializer::testId($in->file, $in->name, $in->rank);
            case 'callSiteId':
                return Serializer::callSiteId($in->testId, $in->module, $in->export, $in->depth, $in->sequence);
            default:
                $text = Json::canonical($in->value, $in->indent);
                return (object) ['text' => $text, 'sha256' => Json::sha256($text)];
        }
    }

    /** Égalité JSON stricte (-0 ≠ 0) avec les jokers `$match` et `$prefix`. */
    public static function same(mixed $got, mixed $exp): bool
    {
        if ($exp instanceof \stdClass && property_exists($exp, '$match')) {
            return is_string($got);
        }
        if ($exp instanceof \stdClass && property_exists($exp, '$prefix')) {
            return is_array($got) && array_is_list($got) && self::same(array_slice($got, 0, count($exp->{'$prefix'})), $exp->{'$prefix'});
        }
        if ($exp instanceof \stdClass) {
            if (!$got instanceof \stdClass) {
                return false;
            }
            $g = get_object_vars($got);
            $e = get_object_vars($exp);
            if (count($g) !== count($e)) {
                return false;
            }
            foreach ($e as $k => $v) {
                if (!array_key_exists($k, $g) || !self::same($g[$k], $v)) {
                    return false;
                }
            }
            return true;
        }
        if (is_array($exp)) {
            if (!is_array($got) || count($got) !== count($exp)) {
                return false;
            }
            foreach ($exp as $i => $v) {
                if (!array_key_exists($i, $got) || !self::same($got[$i], $v)) {
                    return false;
                }
            }
            return true;
        }
        if ((is_int($exp) || is_float($exp)) && (is_int($got) || is_float($got))) {
            return $got == $exp;
        }
        return $got === $exp;
    }
}
