<?php

declare(strict_types=1);

namespace Varia\Probe\Tests;

use PHPUnit\Framework\TestCase;
use Varia\Probe\Probe;
use Varia\Probe\Serializer;

final class ProbeTest extends TestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/varia-php-probe-' . bin2hex(random_bytes(4));
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        Probe::activate(null);
        array_map('unlink', glob($this->dir . '/*') ?: []);
        rmdir($this->dir);
    }

    /** @param array<string, mixed> $json */
    private function file(string $name, array $json): string
    {
        file_put_contents("$this->dir/$name", json_encode($json));
        return "$this->dir/$name";
    }

    /** @return list<array<string, mixed>> */
    private function lines(Probe $p): array
    {
        return array_map(fn ($l) => json_decode($l, true), file($p->logFile, FILE_IGNORE_NEW_LINES) ?: []);
    }

    /** @param array<string, string> $extra */
    private function probe(string $mode = 'observe', array $extra = []): Probe
    {
        $p = Probe::init([
            'VARIA_MODE' => $mode,
            'VARIA_RUN_DIR' => $this->dir,
            'VARIA_TARGETS' => $this->file('targets.json', ['runId' => 'r1', 'projectRoot' => '/proj']),
            'VARIA_REDACT' => $this->file('redact.json', ['fields' => ['password'], 'hmacKey' => 'k']),
        ] + $extra, 42);
        $this->assertNotNull($p);
        return $p;
    }

    public function testInactiveHorsDunRun(): void
    {
        $this->assertNull(Probe::init([], 1));
        $this->assertNull(Probe::init(['VARIA_MODE' => 'autre', 'VARIA_RUN_DIR' => $this->dir], 1));
        $this->assertNull(Probe::init(['VARIA_MODE' => 'observe'], 1));
        // Sans sonde active : appel d'origine.
        $this->assertSame([1], Probe::call('m', 'f', [1], fn (array $a) => $a));
        // Fichiers absents ou illisibles : valeurs par défaut.
        file_put_contents("$this->dir/bad.json", 'pas du json');
        $p = Probe::init(['VARIA_MODE' => 'observe', 'VARIA_RUN_DIR' => $this->dir, 'VARIA_TARGETS' => "$this->dir/bad.json"], 1);
        $this->assertSame(['', (string) getcwd()], [$p?->runId, $p?->projectRoot]);
    }

    public function testObservationTestEtIdentites(): void
    {
        $p = $this->probe();
        Probe::activate($p);
        $this->assertSame($p, Probe::current());
        $p->hello(42);
        $p->testStart('/proj/tests/ATest.php', 'a');
        $r = Probe::call('src/A.php', 'f', [['password' => 'hunter2', 'n' => 1]], function (array $a) {
            return Probe::call('src/A.php', 'g', [$a[0]['n']], fn (array $b) => $b[0] + 1);
        });
        $this->assertSame(2, $r);
        try {
            Probe::call('src/A.php', 'f', ['x'], fn () => throw new \DomainException('mot hunter2'));
        } catch (\DomainException) {
        }
        $p->testEnd();
        $p->testStart('/proj/tests/ATest.php', 'a');
        $p->testEnd();
        Probe::call('src/A.php', 'f', [], fn () => null);
        $l = $this->lines($p);
        $this->assertSame(['HELLO', 'TEST_START', 'OBSERVE_CALL', 'OBSERVE_CALL', 'TARGET_RETURN', 'TARGET_RETURN', 'OBSERVE_CALL', 'TARGET_THROW', 'TEST_END', 'TEST_START', 'TEST_END', 'OBSERVE_CALL', 'TARGET_RETURN'], array_column($l, 'type'));
        $this->assertSame([2, 1, null], [$l[0]['protocolMinor'], $l[0]['protocolVersion'], $l[0]['mutationId']]);
        $t0 = Serializer::testId('tests/ATest.php', 'a', 0);
        $this->assertSame([$t0, Serializer::testId('tests/ATest.php', 'a', 1)], [$l[1]['testId'], $l[9]['testId']]);
        $this->assertSame([0, 1, 0, 1], [$l[2]['depth'], $l[3]['depth'], $l[2]['sequence'], $l[6]['sequence']]);
        $this->assertSame(Serializer::callSiteId($t0, 'src/A.php', 'f', 0, 0), $l[2]['callSiteId']);
        $this->assertTrue($l[2]['args'][0]['password']['$redacted']);
        // Secret de l'appel retiré du message d'erreur ; hors test : callSiteId null.
        $this->assertSame('mot hunter2', $l[7]['error']['message']);
        $this->assertNull($l[11]['callSiteId']);
        $this->assertStringNotContainsString('"hunter2"', (string) file_get_contents($p->logFile));
        $this->assertSame('/ailleurs/x.php', Probe::relative('/proj', '/ailleurs/x.php'));
    }

    public function testSecretRetireDuMessage(): void
    {
        $p = $this->probe();
        try {
            $p->invoke('m', 'f', [['password' => 'hunter2']], fn () => throw new \Exception('mot hunter2'));
        } catch (\Exception) {
        }
        $this->assertSame('mot [REDACTED]', $this->lines($p)[1]['error']['message']);
    }

    public function testArgumentsOmisAuDelaDe20Appels(): void
    {
        $p = $this->probe();
        $p->testStart('/proj/t.php', 't');
        for ($i = 0; $i < 21; $i++) {
            $p->invoke('m', 'f', [$i], fn () => null);
        }
        $last = array_values(array_filter($this->lines($p), fn ($l) => $l['type'] === 'OBSERVE_CALL'))[20];
        $this->assertSame([true, false], [$last['argsOmitted'], isset($last['args'])]);
    }

    /** Mutation du plan pour l'appel (test « t », f, profondeur 0, rang 0) aux arguments $args. */
    private function fuzz(array $args, array $path, mixed $value = null, ?string $fingerprint = null): Probe
    {
        $site = Serializer::callSiteId(Serializer::testId('t.php', 't', 0), 'm', 'f', 0, 0);
        $fp = $fingerprint ?? Serializer::fingerprint(Serializer::fromRedact(['fields' => ['password'], 'hmacKey' => 'k'])->forExport('f')->serializeArgs($args));
        $plan = $this->file('plan.json', ['mutations' => [
            ['id' => 'm_autre', 'callSiteId' => 'x', 'argsFingerprint' => 'x', 'path' => ['0'], 'op' => 'set', 'value' => 1],
            ['id' => 'm_1', 'callSiteId' => $site, 'argsFingerprint' => $fp, 'path' => $path, 'op' => 'set', 'value' => $value],
            'pas un objet',
        ]]);
        $p = $this->probe('fuzz', ['VARIA_PLAN' => $plan, 'VARIA_MUTATION_ID' => 'm_1']);
        $p->testStart('/proj/t.php', 't');
        return $p;
    }

    public function testMutationAppliqueeSurUneCopie(): void
    {
        $p = $this->fuzz([['name' => 'Ada']], ['0', 'name'], (object) []);
        $args = [['name' => 'Ada']];
        $seen = $p->invoke('m', 'f', $args, fn (array $a) => $a);
        $this->assertEquals([['name' => new \stdClass()]], $seen);
        $this->assertSame('Ada', $args[0]['name']);
        $l = $this->lines($p);
        $this->assertSame(['MUTATE_CALL', true, true], [$l[1]['type'], $l[1]['applied'], $l[2]['mutated']]);
        // Second appel (rang 1) : jamais muté.
        $this->assertSame($args, $p->invoke('m', 'f', $args, fn (array $a) => $a));
    }

    public function testEmpreinteDivergenteEtCheminAbsent(): void
    {
        $p = $this->fuzz(['a'], ['0'], null, 'autre');
        $this->assertSame(['a'], $p->invoke('m', 'f', ['a'], fn (array $a) => $a));
        $l = $this->lines($p)[1];
        $this->assertSame([false, 'AMBIGUOUS_CALL_SITE', 'autre'], [$l['applied'], $l['reason'], $l['expectedFingerprint']]);
        unlink($p->logFile);
        $q = $this->fuzz(['a'], ['0', 'x', 'y']);
        $this->assertSame(['a'], $q->invoke('m', 'f', ['a'], fn (array $a) => $a));
        $this->assertSame('PATH_NOT_FOUND', $this->lines($q)[1]['reason']);
    }

    public function testSondeDefensive(): void
    {
        $p = $this->probe();
        $err = '';
        $p->stderr = function (string $s) use (&$err): void {
            $err .= $s;
        };
        $p->write = fn (string $l) => throw new \RuntimeException('disque plein');
        // Préparation impossible : appel d'origine, marqueur sur stderr.
        $this->assertSame(['a'], $p->invoke('m', 'f', ['a'], fn (array $a) => $a));
        $this->assertSame(Probe::STDERR_MARKER . " prepare\n", $err);
        // stderr fermé aussi : aucune exception.
        $p->stderr = fn (string $s) => throw new \RuntimeException('fermé');
        $p->probeError('x', new \Exception());
        // Issue impossible à écrire : signalée, la valeur passe.
        @unlink($p->logFile);
        $q = $this->probe();
        $q->write = function (string $l) use ($q): void {
            if (str_contains($l, 'TARGET_')) {
                throw new \RuntimeException('plein');
            }
            file_put_contents($q->logFile, $l, FILE_APPEND);
        };
        $this->assertSame(1, $q->invoke('m', 'f', [], fn () => 1));
        $this->assertSame(['OBSERVE_CALL', 'PROBE_ERROR'], array_column($this->lines($q), 'type'));
        $this->assertSame('outcome', $this->lines($q)[1]['reason']);
        // Journal inaccessible : l'écriture par défaut lève.
        $r = Probe::init(['VARIA_MODE' => 'observe', 'VARIA_RUN_DIR' => "$this->dir/absent"], 1);
        $this->expectException(\RuntimeException::class);
        ($r?->write)('x');
    }

    public function testEcrituresParDefaut(): void
    {
        $p = $this->probe();
        $this->assertMatchesRegularExpression('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/', ($p->now)());
        $stderr = fopen('php://memory', 'w+');
        ($p->stderr)('');
        $this->assertIsResource($stderr);
    }
}
