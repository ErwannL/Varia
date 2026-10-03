<?php

declare(strict_types=1);

namespace Varia\Probe;

/**
 * Réécriture du source d'une classe au chargement (stratégie 1, chargeur d'autoload enveloppant) :
 * chaque méthode PUBLIQUE non abstraite et non magique `m` devient une enveloppe qui appelle la sonde,
 * le corps d'origine passant dans une méthode privée `m__varia` de même signature. Les lignes sont
 * conservées (enveloppe insérée sur la ligne de la déclaration). `__DIR__`/`__FILE__` sont remplacés
 * par les chemins d'origine, `__FUNCTION__`/`__METHOD__` du corps par les noms d'origine.
 */
final class Rewriter
{
    private const MODIFIERS = [T_PUBLIC, T_PROTECTED, T_PRIVATE, T_STATIC, T_FINAL, T_ABSTRACT];
    private const SKIP = [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT];

    /** @var list<\PhpToken> */
    private array $t;
    /** @var list<string> */
    public array $wrapped = [];
    /** @var list<string> */
    public array $unsupported = [];
    private string $namespace = '';

    public function __construct(string $code, private readonly string $file, private readonly string $module)
    {
        $this->t = \PhpToken::tokenize($code);
    }

    /** Source réécrit ; `wrapped` et `unsupported` listent les méthodes enveloppées / non enveloppables. */
    public function rewrite(): string
    {
        $out = '';
        $n = count($this->t);
        for ($i = 0; $i < $n; $i++) {
            $tok = $this->t[$i];
            if ($tok->is(T_NAMESPACE) && $this->t[$this->next($i)]->is([T_STRING, T_NAME_QUALIFIED])) {
                $this->namespace = $this->t[$this->next($i)]->text;
            }
            if ($tok->is(T_CLASS) && $this->isClassDeclaration($i)) {
                [$text, $i] = $this->classBody($i);
                $out .= $text;
                continue;
            }
            $out .= $this->constant($tok);
        }
        return $out;
    }

    private function constant(\PhpToken $tok): string
    {
        return match ($tok->id) {
            T_DIR => var_export(dirname($this->file), true),
            T_FILE => var_export($this->file, true),
            default => $tok->text,
        };
    }

    /** Jeton significatif suivant (au plus le dernier jeton du fichier). */
    private function next(int $i): int
    {
        $j = $i + 1;
        while ($j < count($this->t) - 1 && $this->t[$j]->is(self::SKIP)) {
            $j++;
        }
        return min($j, count($this->t) - 1);
    }

    /** Jeton significatif précédent (au plus la balise d'ouverture, jeton 0). */
    private function prev(int $i): int
    {
        $j = $i - 1;
        while ($j > 0 && $this->t[$j]->is(self::SKIP)) {
            $j--;
        }
        return $j;
    }

    /** `class Nom` (ni `Foo::class`, ni classe anonyme `new class`). */
    private function isClassDeclaration(int $i): bool
    {
        return !$this->t[$this->prev($i)]->is([T_DOUBLE_COLON, T_NEW]) && $this->t[$this->next($i)]->is(T_STRING);
    }

    /** Index de l'accolade fermante appariée à l'ouvrante `$open`. */
    private function matching(int $open): int
    {
        $depth = 0;
        for ($j = $open; $j < count($this->t); $j++) {
            $x = $this->t[$j];
            if ($x->text === '{' || $x->is([T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES])) {
                $depth++;
            } elseif ($x->text === '}' && --$depth === 0) {
                return $j;
            }
        }
        throw new \ParseError('accolade non fermée');
    }

    /** @return array{0: string, 1: int} texte réécrit de la classe et index de sa dernière accolade */
    private function classBody(int $i): array
    {
        $class = $this->t[$this->next($i)]->text;
        $open = $i;
        while ($this->t[$open]->text !== '{') {
            $open++;
        }
        $close = $this->matching($open);
        $out = '';
        for ($j = $i; $j <= $open; $j++) {
            $out .= $this->t[$j]->text;
        }
        $member = '';
        for ($j = $open + 1; $j < $close; $j++) {
            $x = $this->t[$j];
            if ($x->is(T_FUNCTION)) {
                [$text, $j] = $this->method($class, $j);
                // Modificateurs déjà émis dans $member : la méthode les reprend en tête.
                $out .= $this->stripModifiers($member) . $text;
                $member = '';
                continue;
            }
            if ($x->text === '{' || $x->is([T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES])) {
                $end = $this->matching($j);
                for ($k = $j; $k <= $end; $k++) {
                    $member .= $this->constant($this->t[$k]);
                }
                $j = $end;
                continue;
            }
            $member .= $this->constant($x);
            if ($x->text === ';' || $x->text === '}') {
                $out .= $member;
                $member = '';
            }
        }
        return [$out . $member . '}', $close];
    }

    /** Retire de la fin de $member les modificateurs de la méthode (repris par method()). */
    private function stripModifiers(string $member): string
    {
        return (string) preg_replace('/((?:public|protected|private|static|final|abstract)\s+)+$/i', '', $member);
    }

    /** @return array{0: string, 1: int} */
    private function method(string $class, int $f): array
    {
        $mods = [];
        for ($p = $this->prev($f); $this->t[$p]->is(self::MODIFIERS); $p = $this->prev($p)) {
            array_unshift($mods, strtolower($this->t[$p]->text));
        }
        $j = $this->next($f);
        $byRefReturn = $this->t[$j]->text === '&' || $this->t[$j]->is([T_AMPERSAND_NOT_FOLLOWED_BY_VAR_OR_VARARG, T_AMPERSAND_FOLLOWED_BY_VAR_OR_VARARG]);
        if ($byRefReturn) {
            $j = $this->next($j);
        }
        $name = $this->t[$j]->text;
        $paramsOpen = $this->next($j);
        $depth = 0;
        $byRefParam = false;
        for ($k = $paramsOpen; ; $k++) {
            $depth += match ($this->t[$k]->text) { '(' => 1, ')' => -1, default => 0 };
            $byRefParam = $byRefParam || $this->t[$k]->is(T_AMPERSAND_FOLLOWED_BY_VAR_OR_VARARG);
            if ($depth === 0) {
                break;
            }
        }
        $paramsClose = $k;
        $bodyOpen = $paramsClose;
        while ($this->t[$bodyOpen]->text !== '{' && $this->t[$bodyOpen]->text !== ';') {
            $bodyOpen++;
        }
        $end = $this->t[$bodyOpen]->text === ';' ? $bodyOpen : $this->matching($bodyOpen);
        $signature = '';
        for ($k = $paramsOpen; $k < $bodyOpen; $k++) {
            $signature .= $this->t[$k]->text;
        }
        $returnType = strtolower(trim((string) preg_replace('/^.*\)\s*:/s', '', $signature)));
        $static = in_array('static', $mods, true);
        $head = implode(' ', $mods) . ($mods === [] ? '' : ' ') . 'function ' . ($byRefReturn ? '&' : '');
        // Export = nom de la méthode (un fichier PSR-4 = une classe) : `createUser#arg0.password`.
        $export = $name;
        $public = !in_array('private', $mods, true) && !in_array('protected', $mods, true);
        $wrappable = $public && !in_array('abstract', $mods, true) && $end !== $bodyOpen && !str_starts_with($name, '__');
        if ($wrappable && ($byRefReturn || $byRefParam)) {
            $this->unsupported[] = $export;
            $wrappable = false;
        }
        $body = '';
        for ($k = $bodyOpen; $k <= $end; $k++) {
            $tok = $this->t[$k];
            $body .= match (true) {
                $wrappable && $tok->is(T_FUNC_C) => var_export($name, true),
                $wrappable && $tok->is(T_METHOD_C) => var_export(ltrim($this->namespace . '\\' . $class, '\\') . '::' . $name, true),
                default => $this->constant($tok),
            };
        }
        if (!$wrappable) {
            return [$head . $name . $signature . $body, $end];
        }
        $this->wrapped[] = $export;
        $target = $static ? 'self::' : '$this->';
        $call = '\\Varia\\Probe\\Probe::call(' . var_export($this->module, true) . ', ' . var_export($export, true)
            . ', \\func_get_args(), fn (array $varia_args) => ' . $target . $name . '__varia(...$varia_args));';
        $wrapper = in_array($returnType, ['void', 'never'], true) ? $call : 'return ' . $call;
        $orig = 'private ' . ($static ? 'static ' : '') . 'function ' . $name . '__varia' . $signature . $body;
        // Enveloppe sur la ligne de la signature : le nombre de lignes du fichier est conservé.
        return [$head . $name . rtrim($signature) . ' { ' . $wrapper . ' } ' . $orig, $end];
    }
}
