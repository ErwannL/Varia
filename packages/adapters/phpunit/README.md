# packages/adapters/phpunit/

Adapter **PHPUnit** (R-03, J4) : `@varia/adapter-phpunit`. La sonde est écrite en PHP
([`runtime/`](runtime/README.md)) et fournie avec Varia : rien n'est installé ni écrit dans le projet
testé (bootstrap et extension passés en ligne de commande, cache PHPUnit et copies réécrites dans le
dossier du run).

| Dossier                         | Contenu                                                                     |
| ------------------------------- | --------------------------------------------------------------------------- |
| [`src/`](src/README.md)         | `PhpunitAdapter` (interface `TestAdapter`), capacités déclarées, résultats  |
| [`runtime/`](runtime/README.md) | sonde PHP (norme du protocole 1.2), bootstrap, extension PHPUnit, ses tests |
| [`test/`](test/README.md)       | tests vitest : adapter, suite de conformité, tests PHP de la sonde + pcov   |

## Stratégie d'injection retenue (méthode J0)

1. **Chargeur d'autoload enveloppant** (retenue) : un chargeur placé **en tête** de la pile
   `spl_autoload` demande le fichier de la classe aux chargeurs Composer (puis aux règles PSR-4 du
   `composer.json` du projet) ; si ce fichier est une cible (`targets.include`/`exclude`), il charge une
   **copie réécrite** (jetons PHP, `PhpToken`) : chaque méthode publique `m` devient une enveloppe qui
   appelle la sonde, le corps passant dans une méthode privée `m__varia` de même signature. Les numéros
   de ligne sont conservés ; les piles d'erreur montrent le fichier d'origine.
2. Extension PHPUnit enveloppant des cibles **déclarées** : non nécessaire (la stratégie 1 satisfait
   les scénarios du §5) ; non implémentée.

## Ce qui n'est pas observable (dit, jamais simulé)

- fonctions globales et fichiers chargés par `require`/`include` ou par `autoload.files` (aucun
  autoload) ; un projet dont les cibles ne passent pas par l'autoload ⇒ `doctor` :
  `UNSUPPORTED_PROBE` / `NO_TARGET_MODULE_WRAPPED` ;
- méthodes privées et protégées (appels internes), méthodes magiques (`__construct`, `__call`…),
  méthodes abstraites, méthodes de **traits** et d'énumérations, classes anonymes ;
- méthodes à paramètre par référence ou à retour par référence (listées `unsupported` dans DISCOVER) ;
- classes déjà chargées avant le bootstrap de Varia ;
- l'asynchrone : PHP n'a ni promesse ni rejet non géré (scénario (8) NOT FEASIBLE ; `asyncTargets` non
  déclaré). Un appel interne `self::m()`/`$this->m()` à une méthode publique cible **est** observé, à
  la profondeur 1 (jamais muté : seuls les appels de profondeur 0 le sont).

Export = nom de la méthode (un fichier PSR-4 = une classe) ; module = chemin du fichier. Nom de test =
TestDox de PHPUnit (`#[TestDox]`, paramètres substitués) ; sélection d'un test : liste des tests
obtenue par l'extension (mode liste) puis `--filter` exact.
