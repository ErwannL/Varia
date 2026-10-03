<?php

declare(strict_types=1);

namespace Fixture\Cibles;

interface Forme
{
    public function aire(): float;
}

trait Bavard
{
    public function parler(): string
    {
        return 'bla';
    }
}

abstract class Base implements Forme
{
    abstract public function nom(): string;
}

final class Carre extends Base
{
    use Bavard {
        parler as protected bavarder;
    }

    public const NOMS = ['a' => '{', 'b' => '}'];
    private array $cache = [];

    public function __construct(private float $cote = 2.0)
    {
    }

    public function aire(): float
    {
        return $this->cote * $this->cote;
    }

    public function nom(): string
    {
        return "carré {$this->cote} " . __FUNCTION__ . ' ' . __METHOD__ . ' ' . basename(__DIR__) . ' ' . basename(__FILE__);
    }

    final public static function creer(float $c = 1.0): static
    {
        return new static($c);
    }

    public function oublier(): void
    {
        $this->cache = [];
    }

    public function &reference(): array
    {
        return $this->cache;
    }

    public function ajouter(array &$liste): void
    {
        $liste[] = 1;
    }

    protected function interne(): int
    {
        return self::class === Carre::class ? 1 : 0;
    }

    public function anonyme(): object
    {
        return new class () {
            public function f(): int
            {
                return 1;
            }
        };
    }
}
