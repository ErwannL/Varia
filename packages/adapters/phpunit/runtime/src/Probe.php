<?php

declare(strict_types=1);

namespace Varia\Probe;

/**
 * Sonde PHP (norme 1.2) : observe chaque appel d'une méthode enveloppée, applique au plus UNE
 * mutation sur une copie des arguments, écrit des JSONL (une ligne écrite et vidée à la fois).
 * Défensive : une erreur de la sonde est signalée `PROBE_ERROR` et la cible est appelée sans mutation.
 */
final class Probe
{
    public const PROTOCOL_VERSION = 1;
    public const PROTOCOL_MINOR = 2;
    public const MAX_LOGGED_CALLS = 20;
    public const STDERR_MARKER = '[varia] PROBE_ERROR';

    private static ?self $current = null;

    public string $runId = '';
    public string $projectRoot = '';
    /** @var array<string, mixed>|null */
    public ?array $mutation = null;
    public Serializer $redaction;
    /** @var array{testId: string, file: string, name: string}|null */
    public ?array $test = null;
    /** @var array<string, int> */
    private array $sequences = [];
    /** @var array<string, int> */
    private array $ranks = [];
    private int $callCounter = 0;
    /** @var list<array{depth: int, callId: int}> pile des appels en cours (PHP est synchrone) */
    private array $stack = [];
    /** @var \Closure(string): void */
    public \Closure $write;
    /** @var \Closure(string): void */
    public \Closure $stderr;
    /** @var \Closure(): string */
    public \Closure $now;

    private function __construct(public readonly string $mode, public readonly string $logFile)
    {
        $this->redaction = new Serializer();
        $this->write = function (string $line): void {
            if (@file_put_contents($this->logFile, $line, FILE_APPEND) === false) {
                throw new \RuntimeException('journal inaccessible : ' . $this->logFile);
            }
        };
        $this->stderr = function (string $s): void {
            fwrite(STDERR, $s);
        };
        $this->now = fn (): string => (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    }

    /**
     * État de la sonde depuis l'environnement ; `null` hors d'un run Varia (sonde inactive).
     *
     * @param array<string, string> $env
     */
    public static function init(array $env, int $pid): ?self
    {
        $mode = $env['VARIA_MODE'] ?? '';
        $runDir = $env['VARIA_RUN_DIR'] ?? '';
        if (($mode !== 'observe' && $mode !== 'fuzz') || $runDir === '') {
            return null;
        }
        $st = new self($mode, $runDir . DIRECTORY_SEPARATOR . "probe-$pid.jsonl");
        $targets = self::readJson($env['VARIA_TARGETS'] ?? '');
        $st->runId = (string) ($targets['runId'] ?? '');
        $st->projectRoot = (string) ($targets['projectRoot'] ?? getcwd());
        $st->redaction = Serializer::fromRedact(self::readJson($env['VARIA_REDACT'] ?? ''));
        if ($mode === 'fuzz') {
            // Objets JSON gardés en stdClass : `{}` et `[]` restent distincts dans la valeur mutée.
            $plan = json_decode((string) @file_get_contents($env['VARIA_PLAN'] ?? ''), false);
            foreach ((array) ($plan->mutations ?? []) as $m) {
                if ($m instanceof \stdClass && ($m->id ?? null) === ($env['VARIA_MUTATION_ID'] ?? '')) {
                    $st->mutation = ['value' => $m->value ?? null] + array_map(
                        fn ($v) => $v instanceof \stdClass ? null : $v,
                        get_object_vars($m),
                    );
                }
            }
        }
        return $st;
    }

    /** @return array<string, mixed> */
    private static function readJson(string $file): array
    {
        if ($file === '' || !is_file($file)) {
            return [];
        }
        $v = json_decode((string) file_get_contents($file), true);
        return is_array($v) ? $v : [];
    }

    public static function current(): ?self
    {
        return self::$current;
    }

    public static function activate(?self $st): void
    {
        self::$current = $st;
    }

    /** @param array<string, mixed> $fields */
    public function emit(string $type, array $fields): void
    {
        $msg = [
            'protocolVersion' => self::PROTOCOL_VERSION,
            'runId' => $this->runId,
            'type' => $type,
            'testId' => $this->test['testId'] ?? null,
            'timestamp' => ($this->now)(),
        ] + $fields;
        ($this->write)(Json::line((object) $msg) . "\n");
    }

    /** @param array<string, mixed> $extra */
    public function probeError(string $stage, mixed $e, array $extra = []): void
    {
        try {
            $this->emit('PROBE_ERROR', ['reason' => $stage, 'error' => Serializer::error($e)] + $extra);
        } catch (\Throwable) {
            try {
                ($this->stderr)(self::STDERR_MARKER . " $stage\n");
            } catch (\Throwable) {
                // Plus aucun canal : l'absence d'issue sera classée par l'oracle.
            }
        }
    }

    public function hello(int $pid): void
    {
        $this->emit('HELLO', [
            'protocolMinor' => self::PROTOCOL_MINOR,
            'mode' => $this->mode,
            'pid' => $pid,
            'mutationId' => $this->mutation['id'] ?? null,
        ]);
    }

    /** Début d'un test : identité (fichier relatif POSIX, nom complet, rang des homonymes). */
    public function testStart(string $absFile, string $name): void
    {
        $file = self::relative($this->projectRoot, $absFile);
        $key = $file . "\0" . $name;
        $rank = $this->ranks[$key] ?? 0;
        $this->ranks[$key] = $rank + 1;
        $this->test = ['testId' => Serializer::testId($file, $name, $rank), 'file' => $file, 'name' => $name];
        $this->sequences = [];
        $this->emit('TEST_START', ['file' => $file, 'name' => $name]);
    }

    public function testEnd(): void
    {
        $this->emit('TEST_END', []);
        $this->test = null;
    }

    /** Chemin relatif POSIX (`src/Users.php`) ; hors de la racine : chemin absolu POSIX. */
    public static function relative(string $root, string $abs): string
    {
        $root = rtrim(str_replace('\\', '/', $root), '/') . '/';
        $abs = str_replace('\\', '/', $abs);
        return str_starts_with($abs, $root) ? substr($abs, strlen($root)) : $abs;
    }

    /**
     * Point d'entrée des méthodes enveloppées (code généré par le Rewriter).
     *
     * @param list<mixed> $args
     * @param \Closure(list<mixed>): mixed $invoke appel de la méthode d'origine
     */
    public static function call(string $module, string $export, array $args, \Closure $invoke): mixed
    {
        $st = self::$current;
        return $st === null ? $invoke($args) : $st->invoke($module, $export, $args, $invoke);
    }

    /**
     * @param list<mixed> $args
     * @param \Closure(list<mixed>): mixed $invoke
     */
    public function invoke(string $module, string $export, array $args, \Closure $invoke): mixed
    {
        try {
            [$store, $callArgs, $ser] = $this->prepare($module, $export, $args);
        } catch (\Throwable $e) {
            $this->probeError('prepare', $e, ['module' => $module, 'export' => $export]);
            return $invoke($args);
        }
        $started = hrtime(true);
        $this->stack[] = $store;
        try {
            $result = $invoke($callArgs);
        } catch (\Throwable $e) {
            array_pop($this->stack);
            $this->outcome('TARGET_THROW', $store, $started, fn () => ['error' => Serializer::error($e, $ser->secrets)]);
            throw $e;
        }
        array_pop($this->stack);
        $this->outcome('TARGET_RETURN', $store, $started, fn () => ['async' => false, 'value' => $ser->serializeReturn($result)]);
        return $result;
    }

    /**
     * @param array{depth: int, callId: int, callSiteId: string|null} $store
     * @param \Closure(): array<string, mixed> $extra
     */
    private function outcome(string $type, array $store, int $started, \Closure $extra): void
    {
        try {
            $this->emit($type, [
                'callId' => $store['callId'],
                'callSiteId' => $store['callSiteId'],
                'durationMs' => (hrtime(true) - $started) / 1e6,
            ] + $extra());
        } catch (\Throwable $e) {
            $this->probeError('outcome', $e, ['callId' => $store['callId']]);
        }
    }

    /**
     * Observation et décision de mutation ; peut lever (valeur hostile), jamais la cible.
     *
     * @param list<mixed> $args
     * @return array{0: array{depth: int, callId: int, callSiteId: string|null}, 1: list<mixed>, 2: Serializer}
     */
    private function prepare(string $module, string $export, array $args): array
    {
        $parent = end($this->stack);
        $depth = $parent === false ? 0 : $parent['depth'] + 1;
        $key = "$module#$export#$depth";
        $sequence = $this->sequences[$key] ?? 0;
        $this->sequences[$key] = $sequence + 1;
        $callSiteId = $this->test === null ? null : Serializer::callSiteId($this->test['testId'], $module, $export, $depth, $sequence);
        $callId = ++$this->callCounter;
        $ser = $this->redaction->forExport($export);
        $serialized = $ser->serializeArgs($args);
        $fingerprint = Serializer::fingerprint($serialized);
        $callArgs = $args;
        $mutated = false;
        $m = $this->mutation;
        if ($m !== null && $callSiteId !== null && $callSiteId === ($m['callSiteId'] ?? null)) {
            $base = ['callId' => $callId, 'callSiteId' => $callSiteId, 'mutationId' => (string) $m['id']];
            if ($fingerprint !== ($m['argsFingerprint'] ?? null)) {
                $this->emit('MUTATE_CALL', $base + [
                    'applied' => false,
                    'reason' => 'AMBIGUOUS_CALL_SITE',
                    'expectedFingerprint' => (string) ($m['argsFingerprint'] ?? ''),
                    'argsFingerprint' => $fingerprint,
                ]);
            } else {
                $next = Mutation::apply($args, $m);
                if ($next === null) {
                    $this->emit('MUTATE_CALL', $base + ['applied' => false, 'reason' => 'PATH_NOT_FOUND']);
                } else {
                    $callArgs = $next;
                    $mutated = true;
                    $this->emit('MUTATE_CALL', $base + ['applied' => true]);
                }
            }
        }
        $this->emit('OBSERVE_CALL', [
            'callId' => $callId,
            'callSiteId' => $callSiteId,
            'module' => $module,
            'export' => $export,
            'depth' => $depth,
            'sequence' => $sequence,
            'argsFingerprint' => $fingerprint,
            'mutated' => $mutated,
        ] + ($sequence < self::MAX_LOGGED_CALLS ? ['args' => $serialized] : ['argsOmitted' => true]));
        return [['depth' => $depth, 'callId' => $callId, 'callSiteId' => $callSiteId], $callArgs, $ser];
    }
}
