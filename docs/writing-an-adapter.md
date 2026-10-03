# Écrire un adapter

Un adapter branche un lanceur de tests sur Varia. Deux voies :

- **adapter TypeScript** (`TestAdapter`, paquet `packages/adapters/<nom>`) : pas à pas ci-dessous ;
- **adaptateur `custom`** : aucun code TypeScript, le lanceur implémente lui-même le
  [protocole de sonde](probe-protocol.md) (section « Adaptateur custom »).

Capacités déclarées et **vérifiées** de chaque adaptateur existant : [`adapter-capabilities.md`](adapter-capabilities.md)
(matrice générée par `npm run capabilities`, non recopiée ici pour ne pas diverger).

## Pas à pas (adapter TypeScript)

1. **Générer le squelette** : `varia scaffold adapter mon-lanceur [--dir <dossier>]` (voir
   « Squelette scaffold » ci-dessous). Il compile et passe la conformité dès la génération.
2. **Implémenter `TestAdapter`** (`packages/core/src/adapter.ts`) :
   `id`, `detect(root)` (lanceur et version présents ?), `capabilities()` (capacités **déclarées**),
   `prepare(ctx)` (configuration éphémère **hors du projet**, dans `ctx.tmpDir`), `run(options)` (un
   processus supervisé via `runSupervised`, qui renvoie les résultats de tests et les événements JSONL
   validés par `parseProbeLog`). La sonde chargée dans le processus de test respecte
   [`probe-protocol.md`](probe-protocol.md) : réutilisez `@varia/probe-runtime` en JavaScript, ou écrivez
   une sonde dans le langage du lanceur (exemples : Python, PHP, Java, §13 de la norme).
3. **Passer la suite de conformité** (`@varia/adapter-conformance`, section suivante) sur un projet
   d'exemple réel, à chaque étape.
4. **Rejouer le jeu de conformité du protocole** si la sonde est nouvelle (§12 et §13 de la norme).
5. **Brancher l'adapter dans Varia** : aucun code propre au lanceur hors de `packages/adapters/*`
   (vérifié par `tests/architecture.test.ts`) ; le choix se fait par `test.framework` du `varia.yml`
   (énumération dans `packages/config/src/schema.ts`) et `adapterFor` (`packages/cli/src/shared.ts`).
   Le moteur et le cœur ne connaissent aucun adapter. Un adapter hors du dépôt ne peut pas être chargé
   par le CLI sans cette modification : pour un lanceur externe sans modifier Varia, utilisez `custom`.
6. **Vérifier avec `varia doctor`** sur le projet d'exemple : tests de fumée qui confirment ou
   infirment chaque capacité déclarée (`VERIFIED`, `NOT_VERIFIED`, `UNSUPPORTED`) ; une sonde qui
   n'enveloppe aucun module cible ⇒ `UNSUPPORTED_PROBE` (code de sortie 5). Ajoutez ensuite l'adapter à
   la matrice : `npm run capabilities` régénère `docs/adapter-capabilities.md`, `npm run
capabilities:check` vérifie qu'elle correspond à la mesure.

## Conformité (`@varia/adapter-conformance`, CDC §9.3)

Tout adapter doit passer la suite de conformité. Elle prend l'adapter **réel**, un projet d'exemple
dont le runner est installé (seuls ses fichiers de premier niveau sont copiés, `node_modules` est lié :
l'exemple n'est jamais modifié) et le « dialecte » des fichiers de test du runner :

```ts
import { runConformance } from '@varia/adapter-conformance'

const report = await runConformance({
  adapter: new MonAdapter(),
  example: resolve('examples/mon-projet'),
  dialect: { module: 'esm', ext: 'ts', testImport: "import { expect, test } from 'mon-runner'" },
})
expect(report.checks.filter((c) => c.status !== 'PASS')).toEqual([])
```

Les fichiers `src/conformance.<ext>` et `tests/conformance.test.<ext>` doivent correspondre au motif de
tests du projet. Vérifications, toutes sur un projet jetable, via le moteur réel (`runBaseline`,
`planRun`, `runFuzz`) et l'adapter (`prepare`, `run`) :

| Vérification    | Attendu                                                                                |
| --------------- | -------------------------------------------------------------------------------------- |
| `baseline`      | `BASELINE_DONE`, tous les tests verts                                                  |
| `observation`   | `OBSERVE_CALL` de `greet` avec ses arguments (`[{ name: 'Ada' }]`)                     |
| `async`         | cible `async` observée, `TARGET_RETURN` avec `async: true` et la valeur résolue        |
| `multipleCalls` | trois appels de `add` dans un test : rangs de séquence `0, 1, 2`                       |
| `exception`     | `TARGET_THROW` avec `constructorChain` commençant par `ConformanceError`, puis `Error` |
| `parameterized` | `test.each` : deux tests distincts, chacun avec son appel                              |
| `selection`     | `run({ testFile, testName })` n'exécute que ce test et n'observe que ses cibles        |
| `mutation`      | plan sur `greet` ; chaque mutation appliquée (jamais `SKIPPED` ni `INFRA_ERROR`)       |
| `cleanup`       | projet inchangé (manifeste), aucun processus portant un identifiant du run             |

`cleanup` est `UNVERIFIED` là où les processus ne peuvent pas être listés (Windows) : dit, jamais
simulé. Une exception pendant un groupe fait échouer tout le groupe. La suite tourne dans `npm test`
contre chaque adaptateur réel : Jest et Vitest (`packages/adapter-conformance/test/conformance.test.ts`),
puis `packages/adapters/<nom>/test/conformance.test.ts` pour Mocha (CJS et ESM), pytest, PHPUnit,
JUnit et custom. Elle échoue contre des adapters volontairement défaillants (`broken.test.ts`).
Seule exception connue et assertée : PHPUnit échoue à `async` (PHP n'a pas de promesse, voir plus bas).

## Squelette scaffold (`varia scaffold adapter`, T-02)

Point de départ fonctionnel, généré sans réseau et à l'identique pour un même nom (aucune date) :

1. `varia scaffold adapter mon-lanceur [--dir <dossier>]` crée `<dossier>/mon-lanceur/` (défaut :
   dossier courant). Nom : minuscules, chiffres, tirets isolés, commençant par une lettre, 30 caractères
   au plus. Type ou nom invalide, cible non vide ou qui n'est pas un dossier : refus, rien n'est écrit,
   code de sortie 3.
2. Contenu : `src/index.ts` (`MonLanceurAdapter implements TestAdapter`, identifiant `mon-lanceur`),
   `test/adapter.test.ts` (test unitaire avec un lanceur factice), `test/conformance.test.ts` (la suite
   `runConformance` telle quelle, 9 vérifications), `example/` (projet de conformité Vitest), README,
   `tsconfig.json` strict, `.prettierrc.json` de Varia.
3. `npm install && (cd example && npm install)`, puis `npm run typecheck` et `npm test` : tout passe dès
   la génération, car chaque méthode **délègue** à `VitestAdapter` (forme la plus simple qui passe
   réellement la conformité).
4. Remplacez la délégation méthode par méthode (`detect`, `capabilities`, `prepare`, `run`) par le
   pilotage de votre lanceur, puis adaptez `example/` et le `dialect` de `test/conformance.test.ts`. La
   suite de conformité doit rester verte à chaque étape.

Preuve : `tests/j4/scaffold.test.ts` génère chaque type dans un dossier temporaire, puis exécute
Prettier, `tsc --noEmit` et `vitest run` sur le squelette (paquets `@varia/*` résolus vers les sources
du dépôt par une configuration temporaire posée à côté du squelette).

## Adaptateurs existants

Pour chacun : capacités mesurées dans [`adapter-capabilities.md`](adapter-capabilities.md) ; détail
dans le `README.md` du paquet. Les limites ci-dessous sont dites, jamais simulées.

### Jest (`packages/adapters/jest`)

- **Injection** (stratégie D1, J0) : transform temporaire `runtime/transform.cjs` qui délègue au
  transform du projet (babel-jest, ts-jest via `preset`…) puis enveloppe les exports des modules
  `targets.include` ; configuration Jest éphémère hors du projet (cache propre au run).
- **Exécution** : un processus Jest par exécution, `--runTestsByPath` + `--testNamePattern`, `--json`.
- **Limites** : appels internes à un module non observés ; ESM natif non déclaré ; pièges connus :
  `docs/notes/sonde-jest.md`.

### Vitest (`packages/adapters/vitest`)

- **Injection** : plugin Vite `enforce: pre` (`runtime/plugin.mjs`) limité à `targets.include`, qui
  réécrit les exports ESM (`runtime/rewrite.mjs`, source maps) ; lanceur `runtime/run-vitest.mjs`
  (API `startVitest` de la copie de Vitest **du projet**), setup et cache hors du projet.
- **Limites** : appels internes à un module non observés ; CommonJS non déclaré.

### Mocha (`packages/adapters/mocha`)

- **Injection** : `--require` d'un crochet CommonJS (`runtime/register.cjs`) + `mochaHooks` ; ESM par
  `module.register` (`runtime/esm-hooks.mjs`). Configuration générée hors du projet, `--grep` exact,
  rapporteur JSON vers un fichier. Voir `docs/notes/sonde-mocha.md`.
- **Limites** : pas de couverture (Mocha ne la mesure pas) ; code chargé par `vm`/`eval` non enveloppé
  (`doctor` ⇒ `UNSUPPORTED_PROBE`).

### Pytest (`packages/adapters/pytest`) — Python 3.11

- **Injection** : plugin `-p varia_probe.plugin` (sonde Python fournie dans `runtime/varia_probe/`,
  rien n'est installé dans le projet) et crochet `sys.meta_path` qui publie un module mandataire
  enveloppant les fonctions exportées (D-040). `PYTHONDONTWRITEBYTECODE=1`, `-p no:cacheprovider`.
- **Interpréteur** : `.venv`, `venv` du projet, sinon `python3`.
- **Limites** : appels internes non observés ; classes non enveloppées ; `exec`/`runpy` non
  enveloppés ; `sys.exit` = levée synchrone, seule `os._exit` est une sortie de processus.

### PHPUnit (`packages/adapters/phpunit`) — PHP 8.3, composer

- **Injection** : chargeur d'autoload en tête de pile qui charge une **copie réécrite** des classes
  cibles (méthodes publiques enveloppées, corps dans `m__varia`) dans le dossier du run (D-041).
- **Limites** : fonctions globales, `require` direct, méthodes non publiques, traits, magiques non
  observés ; pas d'asynchrone (`asyncTargets` non déclaré ; la vérification de conformité `async`
  échoue, assertée dans `packages/adapters/phpunit/test/conformance.test.ts`).

### JUnit 5 (`packages/adapters/junit`) — Java 21, Maven

- **Injection** : agent `-javaagent` ByteBuddy (Advice sur méthodes publiques) ; préparation hors ligne
  (`mvn -o dependency:build-classpath`, `javac` dans le dossier du run) ; console JUnit Platform 1.11.4
  (D-042). L'agent est construit par `npm run examples:install`.
- **Limites** : méthodes publiques seulement, constructeurs non observés ; une mutation d'un type
  impossible pour le paramètre Java n'est jamais forcée (`MUTATE_CALL applied:false` ⇒ `SKIPPED`) ; pas
  de valeur « absente » distincte de `null`.

### custom (`packages/adapters/custom`)

- **Injection** : aucune côté Varia ; le lanceur déclaré dans `varia.yml` écrit lui-même les journaux
  de sonde. Contrat complet : section suivante.

## Adaptateur custom

Pour brancher un lanceur **sans écrire de code TypeScript ni modifier Varia** (J4 X-01, CDC §9.4) :
le lanceur implémente lui-même le [protocole de sonde](probe-protocol.md) et le contrat ci-dessous ;
`varia.yml` le déclare (paquet `@varia/adapter-custom`).

```yaml
test:
  framework: custom
  custom:
    command: ['node', 'runner.cjs'] # argv, SANS shell ; `node` = le Node qui exécute Varia
    discover: ['node', 'runner.cjs'] # optionnel : liste les tests (sert à `detect`)
    capabilities: { observation: true, argumentMutation: true, perTestSelection: true, cjs: true }
```

`framework: custom` sans `custom` est refusé (`CUSTOM_COMMAND_REQUIRED`). Un chemin relatif en tête de
commande est résolu dans `test.cwd` (racine du projet pour la découverte) ; un nom nu est cherché dans `PATH` (`PATHEXT` sous Windows : pas
de shell, donc pas de script `.cmd` — utilisez `node script.js` ou un exécutable).

**Entrées** (environnement du processus ; les `VARIA_*` hérités de Varia sont retirés, `test.env` et
`NODE_OPTIONS` du projet sont transmis) :

| Variable                                                                                          | Contenu                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `VARIA_MODE`, `VARIA_RUN_DIR`, `VARIA_TARGETS`, `VARIA_REDACT`, `VARIA_PLAN`, `VARIA_MUTATION_ID` | celles du protocole (§2 de la norme) : la sonde du lanceur les lit et écrit `probe-<pid>.jsonl`                            |
| `VARIA_RESULTS`                                                                                   | chemin du **fichier de résultats** à écrire (toujours fourni)                                                              |
| `VARIA_INCLUDE`, `VARIA_EXCLUDE`                                                                  | tableaux JSON d'expressions régulières (issues de `targets.include/exclude`), appliquées au chemin relatif POSIX du module |
| `VARIA_TEST_FILE`, `VARIA_TEST_NAME`                                                              | sélection (si présentes) : fichier relatif POSIX et nom complet **exact** du seul test à exécuter                          |
| `VARIA_COVERAGE_DIR`                                                                              | si présente : y écrire `coverage-summary.json` (format istanbul)                                                           |

**Fichier de résultats** (JSON, écrit d'un coup en fin d'exécution — fichier temporaire puis
renommage) : `{ "tests": [{ "file": "tests/a.test.js", "name": "suite cas", "status": "passed",
"durationMs": 12 }] }`. `status` ∈ `passed`, `failed`, `skipped`, `other` ; `durationMs` nombre ou
absent. `file`/`name` sont ceux des `TEST_START` de la sonde : Varia recalcule le `testId` du protocole
(§8.1, rang des homonymes compris). Fichier absent, illisible ou hors format (processus tué, sortie
brutale) ⇒ **aucun résultat** (`null`), jamais un résultat deviné. Un test non sélectionné est omis.

**Découverte** (optionnelle) : la commande `discover` est lancée avec `VARIA_DISCOVER=<fichier>` (et
aucune variable du protocole) ; elle écrit `{ "version"?: "1.0.0", "tests": [{ "file", "name" }] }` et
sort avec le code 0. Échec ou hors format ⇒ `detect` rend `RUNNER_NOT_FOUND`. Sans découverte, `detect`
vérifie seulement que la commande existe.

**Capacités** : déclarées dans `test.custom.capabilities` (absentes ⇒ fausses), exposées telles quelles
par l'adaptateur et **vérifiées par `varia doctor`** (tests de fumée : observation, mutation appliquée,
sélection d'un test, async, système de modules, isolement, couverture produite, parallélisme). Un
lanceur qui déclare tout sans écrire de journal de sonde obtient `UNSUPPORTED_PROBE`
(`NO_TARGET_MODULE_WRAPPED`, code de sortie 5) ; une sonde d'une majeure inconnue,
`PROBE_PROTOCOL_UNSUPPORTED`.

**Preuve** : `examples/custom-project/runner.cjs`, lanceur factice qui n'importe rien de Varia, passe
la suite de conformité d'adaptateur (`packages/adapters/custom/test/conformance.test.ts`), rejoue tout
le jeu de conformité du protocole (`protocol.test.ts`) et les scénarios du §5 du jalon J4
(`tests/j4/custom*.test.ts`).
